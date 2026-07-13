// Service Worker — central message router for the Apogee extension.
// Routes requests from the popup to either the offscreen document (WebLLM) or lets the popup handle local backend calls directly.
// Firefox does not support chrome.offscreen or chrome.runtime.getContexts.
// WebLLM (which requires an offscreen document for WebGPU) is only available on Chrome/Edge. Firefox users must use the Local Ollama provider.
const hasOffscreenAPI =
  typeof chrome !== "undefined" &&
  typeof chrome.offscreen !== "undefined" &&
  typeof chrome.offscreen.createDocument === "function";

let offscreenReady = false;
let offscreenScriptReady = false;

// Resolve when the offscreen document's script signals it has loaded.
let _offscreenScriptReadyResolve = null;
let offscreenScriptReadyPromise = new Promise((resolve) => {
  _offscreenScriptReadyResolve = resolve;
});

async function ensureOffscreenDocument() {
  if (!hasOffscreenAPI) {
    throw new Error(
      "In-browser AI (WebLLM) is not supported in Firefox. " +
        "Please switch to Local Ollama mode in Settings.",
    );
  }

  // Check if the offscreen document already exists (Chrome-only API)
  if (typeof chrome.runtime.getContexts === "function") {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen/offscreen.html")],
    });

    if (existingContexts.length > 0) {
      offscreenReady = true;
      offscreenScriptReady = true;
      return;
    }
  } else if (offscreenReady) {
    return;
  }

  offscreenReady = false;
  offscreenScriptReady = false;
  offscreenScriptReadyPromise = new Promise((resolve) => {
    _offscreenScriptReadyResolve = resolve;
  });

  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["WORKERS"],
    justification: "WebGPU-based LLM inference via @mlc-ai/web-llm",
  });

  offscreenReady = true;

  // Wait for the offscreen document's module script to finish loading.
  // The offscreen.js sends an "offscreen-ready" message once its handlers
  // are registered. We use a timeout so the popup isn't stuck indefinitely.
  await Promise.race([
    offscreenScriptReadyPromise,
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
}

function nextStreamId() {
  return crypto.randomUUID();
}

// Active port connections from the popup, keyed by streamId
const popupPorts = new Map();

const OFFSCREEN_IDLE_MS = 5 * 60 * 1000;
let offscreenIdleTimer = null;

function cancelOffscreenIdleClose() {
  if (offscreenIdleTimer !== null) {
    clearTimeout(offscreenIdleTimer);
    offscreenIdleTimer = null;
  }
}

function scheduleOffscreenIdleClose() {
  cancelOffscreenIdleClose();
  offscreenIdleTimer = setTimeout(async () => {
    offscreenIdleTimer = null;
    // Don't close while a stream is still active.
    if (popupPorts.size > 0) {
      scheduleOffscreenIdleClose();
      return;
    }
    try {
      if (typeof chrome !== "undefined" && chrome.offscreen) {
        await chrome.offscreen.closeDocument();
      }
    } catch (err) {
      // ignore if already closed
    }
    offscreenReady = false;
    offscreenScriptReady = false;
  }, OFFSCREEN_IDLE_MS);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup-lifecycle") {
    // A popup is open — keep the model warm.
    cancelOffscreenIdleClose();
    port.onDisconnect.addListener(() => {
      // Defer teardown; a new popup may reopen almost immediately.
      scheduleOffscreenIdleClose();
    });
    return;
  }

  if (!port.name.startsWith("popup-stream-")) return;
  const popupPort = port;

  const streamId = popupPort.name.replace("popup-stream-", "");
  popupPorts.set(streamId, popupPort);

  const offscreenPort = chrome.runtime.connect({
    name: `offscreen-stream-${streamId}`,
  });

  offscreenPort.onMessage.addListener((msg) => {
    try {
      popupPort.postMessage(msg);
    } catch {}
    if (msg.type === "done" || msg.type === "error") {
      popupPorts.delete(streamId);
    }
  });

  offscreenPort.onDisconnect.addListener(() => {
    popupPorts.delete(streamId);
    try {
      popupPort.disconnect();
    } catch {}
  });

  popupPort.onDisconnect.addListener(() => {
    popupPorts.delete(streamId);
    try {
      offscreenPort.disconnect();
    } catch {}
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "service-worker") return false;

  if (message.type === "offscreen-ready") {
    offscreenScriptReady = true;
    _offscreenScriptReadyResolve();
    return false;
  }

  if (message.type === "model-progress") {
    chrome.runtime
      .sendMessage({
        type: "model-progress",
        progress: message.progress,
        modelId: message.modelId,
      })
      .catch(() => {});
    return false;
  }

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          await ensureOffscreenDocument();

          const streamId = nextStreamId();

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

        case "check-webgpu": {
          if (!hasOffscreenAPI) {
            sendResponse({
              supported: false,
              reason: "offscreen API unavailable (Firefox)",
            });
            break;
          }

          await ensureOffscreenDocument();
          let wgpuResponse = null;
          const delays = [0, 200, 500, 1000, 2000];
          for (const delay of delays) {
            if (delay > 0) await new Promise((r) => setTimeout(r, delay));
            try {
              wgpuResponse = await chrome.runtime.sendMessage({
                target: "offscreen",
                action: "check-webgpu",
              });
            } catch {
              wgpuResponse = null;
            }
            if (wgpuResponse && typeof wgpuResponse.supported === "boolean") {
              break;
            }
          }

          sendResponse(
            wgpuResponse || {
              supported: false,
              reason: "offscreen document did not respond",
            },
          );
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
  return true;
});
