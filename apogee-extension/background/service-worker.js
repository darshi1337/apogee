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
const offscreenLogs = [];

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

  // The offscreen doc (and the loaded WebLLM engine) gets torn down after
  // OFFSCREEN_IDLE_MS of inactivity — see scheduleOffscreenIdleClose. If the
  // popup is reopened after that, the model has to reload from scratch,
  // which can take anywhere from a few seconds to over a minute. Without
  // this, the popup just shows a generic "Summarizing"/"Thinking" spinner
  // for that whole stretch with no indication a reload is happening.
  // Piggyback on the existing model-progress UI to surface it.
  chrome.runtime
    .sendMessage({
      type: "model-progress",
      progress: { text: "Reconnecting to local model...", progress: 0 },
    })
    .catch(() => {});

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

// Unique stream IDs. A plain counter resets whenever the MV3 service worker is
// evicted, so IDs could collide across worker restarts; use a UUID instead.
function nextStreamId() {
  return crypto.randomUUID();
}

// Streaming jobs, keyed by streamId, tracked independently of any popup
// connection: the popup closes constantly (on focus loss), but the job keeps
// running and buffering so a reopened popup can replay the text and keep
// receiving chunks.
const activeStreams = new Map();

const STREAM_CLEANUP_MS = 2 * 60 * 1000;
function scheduleStreamCleanup(streamId) {
  setTimeout(() => activeStreams.delete(streamId), STREAM_CLEANUP_MS);
}

function broadcastToStream(stream, msg) {
  for (const port of stream.subscribers) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

// Starts a WebLLM generation job against the offscreen document, decoupled
// from any popup port so it runs to completion even if nothing is listening.
function startOffscreenStream(streamId) {
  const stream = { text: "", done: false, error: null, subscribers: new Set() };
  activeStreams.set(streamId, stream);

  const offscreenPort = chrome.runtime.connect({
    name: `offscreen-stream-${streamId}`,
  });

  offscreenPort.onMessage.addListener((msg) => {
    if (msg.type === "chunk") {
      stream.text += msg.text || "";
    } else if (msg.type === "done") {
      stream.done = true;
    } else if (msg.type === "error") {
      stream.error = msg.error || "Unknown error during streaming";
      stream.done = true;
    }
    broadcastToStream(stream, msg);
    if (msg.type === "done" || msg.type === "error") {
      scheduleStreamCleanup(streamId);
    }
  });

  offscreenPort.onDisconnect.addListener(() => {
    if (!stream.done) {
      stream.error = "Connection to local model was lost";
      stream.done = true;
      broadcastToStream(stream, { type: "error", error: stream.error });
    }
    scheduleStreamCleanup(streamId);
  });
}

// The service worker isn't bound by the extension CSP `connect-src`, so
// constrain the relay to loopback hosts and the providers' fixed endpoints —
// otherwise a bad apiBase/endpoint could turn it into an SSRF fetch proxy.
const ALLOWED_BACKEND_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ALLOWED_BACKEND_ENDPOINTS = new Set([
  "/summarize",
  "/ask",
  "/pdf/url",
  "/suggest-questions",
]);

function resolveBackendUrl(apiBase, endpoint) {
  if (!ALLOWED_BACKEND_ENDPOINTS.has(endpoint)) {
    throw new Error(`Disallowed backend endpoint: ${endpoint}`);
  }
  let url;
  try {
    url = new URL(`${apiBase}${endpoint}`);
  } catch {
    throw new Error("Invalid backend URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Disallowed backend protocol: ${url.protocol}`);
  }
  if (!ALLOWED_BACKEND_HOSTS.has(url.hostname)) {
    throw new Error(`Disallowed backend host: ${url.hostname}`);
  }
  return url.toString();
}

// Runs a streaming fetch against the local Ollama backend, buffering chunks
// the same way as startOffscreenStream so it survives popup close/reopen.
async function startBackendStream(streamId, { apiBase, endpoint, body }) {
  const stream = { text: "", done: false, error: null, subscribers: new Set() };
  activeStreams.set(streamId, stream);

  const finish = (msg) => {
    if (msg.type === "done") stream.done = true;
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.done = true;
    }
    broadcastToStream(stream, msg);
    scheduleStreamCleanup(streamId);
  };

  const emitChunk = (text) => {
    if (!text) return;
    stream.text += text;
    broadcastToStream(stream, { type: "chunk", text });
  };

  let requestUrl;
  try {
    requestUrl = resolveBackendUrl(apiBase, endpoint);
  } catch (err) {
    finish({ type: "error", error: err.message });
    return;
  }

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Apogee-Client": "1",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      finish({
        type: "error",
        error: errText || `Request failed: ${response.status}`,
      });
      return;
    }

    if (!response.body) {
      emitChunk(await response.text());
      finish({ type: "done" });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      emitChunk(decoder.decode(value, { stream: true }));
    }
    emitChunk(decoder.decode());
    finish({ type: "done" });
  } catch (err) {
    finish({ type: "error", error: err.message });
  }
}

// Suggested-question generation runs here (not the popup) so it survives the
// popup closing; the popup observes the result via chrome.storage under
// promptsCacheKey. The Set dedupes concurrent requests for the same key.
const pendingSuggestKeys = new Set();

async function runSuggestQuestionsJob(payload) {
  const {
    promptsCacheKey,
    persist = true,
    providerType,
    apiBase,
    title,
    url,
    summary,
    model,
  } = payload || {};
  if (!promptsCacheKey || pendingSuggestKeys.has(promptsCacheKey)) return;
  pendingSuggestKeys.add(promptsCacheKey);

  let questions = [];
  try {
    if (providerType === "local") {
      const requestUrl = resolveBackendUrl(apiBase, "/suggest-questions");
      const res = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Apogee-Client": "1",
        },
        body: JSON.stringify({ title, url, summary, model }),
      });
      if (res.ok) {
        const data = await res.json();
        questions = Array.isArray(data.questions)
          ? data.questions.slice(0, 2)
          : [];
      }
    } else {
      await ensureOffscreenDocument();
      const resp = await chrome.runtime.sendMessage({
        target: "offscreen",
        action: "suggest-questions",
        payload: { title, url, summary, model },
      });
      questions = resp?.questions || [];
    }
  } catch {
    questions = [];
  }

  // Persist only when allowed (write even [] so the popup can distinguish
  // "generated, none" from "still pending" — a missing key). When history is
  // off or the host is sensitive, keep it ephemeral and rely on the message
  // below for delivery.
  if (persist) {
    await chrome.storage.local.set({ [promptsCacheKey]: questions });
  }
  // Direct delivery to any open popup (the only path when not persisted).
  chrome.runtime
    .sendMessage({ type: "suggested-prompts-ready", promptsCacheKey, questions })
    .catch(() => {});
  pendingSuggestKeys.delete(promptsCacheKey);
}

// The Chrome action popup closes whenever it loses focus, which is constant.
// Tearing down the offscreen document (and therefore the loaded MLCEngine +
// WebGPU device) on every close forces a full model reload on the next use.
// Instead we keep it alive and only close after a period of inactivity, so
// consecutive interactions reuse the already-loaded model.
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
    // Don't close while a stream or suggested-question job is still running.
    const hasActiveJob =
      [...activeStreams.values()].some((s) => !s.done) ||
      pendingSuggestKeys.size > 0;
    if (hasActiveJob) {
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
  const stream = activeStreams.get(streamId);

  if (!stream) {
    try {
      popupPort.postMessage({ type: "error", error: "Unknown or expired stream" });
    } catch {}
    try {
      popupPort.disconnect();
    } catch {}
    return;
  }

  // Attaching just subscribes this popup to the already-running job: replay
  // the buffered text, then stream live chunks. Disconnecting only
  // unsubscribes — it doesn't stop the job.
  stream.subscribers.add(popupPort);
  if (stream.text) {
    try {
      popupPort.postMessage({ type: "chunk", text: stream.text });
    } catch {}
  }
  if (stream.error) {
    try {
      popupPort.postMessage({ type: "error", error: stream.error });
    } catch {}
  } else if (stream.done) {
    try {
      popupPort.postMessage({ type: "done" });
    } catch {}
  }

  popupPort.onDisconnect.addListener(() => {
    stream.subscribers.delete(popupPort);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "service-worker") return false;

  // Only accept messages from this extension's own contexts. Web pages or
  // other extensions carry a different sender.id (or none) and must not
  // be able to drive backend fetches or offscreen inference.
  if (sender.id !== chrome.runtime.id) return false;

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

  if (message.type === "offscreen-log") {
    const timestamp = new Date().toLocaleTimeString();
    offscreenLogs.push(`[${timestamp}] [${message.level.toUpperCase()}] ${message.message}`);
    if (offscreenLogs.length > 50) {
      offscreenLogs.shift();
    }
    chrome.runtime
      .sendMessage({
        type: "live-offscreen-log",
        log: `[${timestamp}] [${message.level.toUpperCase()}] ${message.message}`,
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

          // Start the job now, independent of any popup port.
          startOffscreenStream(streamId);

          sendResponse({ streamId });
          break;
        }

        case "backend-stream": {
          const streamId = nextStreamId();
          startBackendStream(streamId, message.payload);
          sendResponse({ streamId });
          break;
        }

        case "suggest-questions-bg": {
          // Fire and forget — the job persists its result to storage itself.
          runSuggestQuestionsJob(message.payload);
          sendResponse({ started: true });
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

        case "get-offscreen-logs": {
          sendResponse({ logs: offscreenLogs });
          break;
        }

        case "clear-offscreen-logs": {
          offscreenLogs.length = 0;
          sendResponse({ success: true });
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
