// Service Worker — central message router for the Apogee extension.
// Routes requests from the popup to either the offscreen document (WebLLM)
// or lets the popup handle local backend calls directly.

let offscreenReady = false;

async function ensureOffscreenDocument() {
  if (offscreenReady) return;

  // Check if the offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen/offscreen.html")],
  });

  if (existingContexts.length > 0) {
    offscreenReady = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["WORKERS"],
    justification: "WebGPU-based LLM inference via @mlc-ai/web-llm",
  });

  offscreenReady = true;
}

// Counter for unique stream IDs
let streamCounter = 0;

// Active port connections from the popup, keyed by streamId
const popupPorts = new Map();

// ─── Port-based streaming relay ──────────────────────────────────────────────
// The popup connects with a port named `stream-{streamId}`.
// We relay it by opening an identical port to the offscreen document.

chrome.runtime.onConnect.addListener((popupPort) => {
  if (!popupPort.name.startsWith("stream-")) return;

  const streamId = popupPort.name.replace("stream-", "");
  popupPorts.set(streamId, popupPort);

  // Open a matching port to the offscreen document to relay tokens
  const offscreenPort = chrome.runtime.connect({ name: `stream-${streamId}` });

  offscreenPort.onMessage.addListener((msg) => {
    try {
      popupPort.postMessage(msg);
    } catch {
      // popup port may have closed
    }
    if (msg.type === "done" || msg.type === "error") {
      popupPorts.delete(streamId);
    }
  });

  offscreenPort.onDisconnect.addListener(() => {
    popupPorts.delete(streamId);
    try {
      popupPort.disconnect();
    } catch {
      // ignore
    }
  });

  popupPort.onDisconnect.addListener(() => {
    popupPorts.delete(streamId);
    try {
      offscreenPort.disconnect();
    } catch {
      // ignore
    }
  });
});

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages targeted at the service worker
  if (message.target !== "service-worker") return false;

  // Forward model progress from offscreen → popup via stored ports
  if (message.type === "model-progress") {
    // Broadcast progress to all connected popup contexts
    chrome.runtime.sendMessage({
      type: "model-progress",
      progress: message.progress,
      modelId: message.modelId,
    }).catch(() => {
      // No listener — that's fine
    });
    return false;
  }

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          await ensureOffscreenDocument();

          const streamId = String(++streamCounter);

          // Forward to offscreen document — it registers a pending stream
          await chrome.runtime.sendMessage({
            target: "offscreen",
            action: message.action,
            streamId,
            payload: message.payload,
          });

          sendResponse({ streamId });
          break;
        }

        case "suggest-questions": {
          await ensureOffscreenDocument();

          const response = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "suggest-questions",
            payload: message.payload,
          });

          sendResponse(response);
          break;
        }

        case "status": {
          await ensureOffscreenDocument();

          const response = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "status",
          });

          sendResponse(response);
          break;
        }

        case "load-model": {
          await ensureOffscreenDocument();

          const response = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "load-model",
            payload: message.payload,
          });

          sendResponse(response);
          break;
        }

        case "unload-model": {
          if (!offscreenReady) {
            sendResponse({ ready: false });
            break;
          }

          const response = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "unload-model",
          });

          sendResponse(response);
          break;
        }

        default:
          sendResponse({ error: `Unknown action: ${message.action}` });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  };

  handler();
  return true; // async sendResponse
});
