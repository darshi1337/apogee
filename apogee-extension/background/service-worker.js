// Service Worker, central message router for the Apogee extension.
// Routes requests from the popup to either the offscreen document (WebLLM) or a local Ollama instance, talked to directly over HTTP from here.
// Firefox does not support chrome.offscreen or chrome.runtime.getContexts.
// WebLLM (which requires an offscreen document for WebGPU) is only available on Chrome/Edge. Firefox users must use the Local Ollama provider.

import { summarizeText } from "../lib/ollamaSummarize.js";
import { chatStream, chatOnce, checkHealth } from "../lib/ollamaClient.js";
import {
  buildAnswerPrompt,
  buildSuggestQuestionsPrompt,
} from "../lib/prompts.js";
import { truncateForPrompt } from "../lib/chunk.js";
import { parseSuggestedQuestions } from "../lib/questions.js";
import { extractPdfText } from "../lib/pdfExtract.js";

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

// Memoizes the in-flight creation so concurrent callers (e.g. the popup's
// "check-webgpu" probe on load racing a "summarize" click) await the same
// promise instead of each calling chrome.offscreen.createDocument(), a
// second concurrent call throws "Only a single offscreen document may be
// created" since Chrome only allows one at a time.
let ensureOffscreenPromise = null;

function ensureOffscreenDocument() {
  if (!ensureOffscreenPromise) {
    ensureOffscreenPromise = ensureOffscreenDocumentOnce().finally(() => {
      ensureOffscreenPromise = null;
    });
  }
  return ensureOffscreenPromise;
}

// Whether the offscreen document currently exists, checked directly via
// chrome.runtime.getContexts rather than trusted from the in-memory
// offscreenReady flag alone: that flag resets to false on every restart of
// this worker even though the offscreen document, which has its own
// lifecycle independent of this worker, see OFFSCREEN_IDLE_ALARM above,
// may well still be alive.
async function offscreenDocumentExists() {
  if (!hasOffscreenAPI) return false;
  if (typeof chrome.runtime.getContexts === "function") {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen/offscreen.html")],
    });
    return existingContexts.length > 0;
  }
  // No getContexts (Chrome 109-115), fall back to the in-memory flag, the
  // best information available without it.
  return offscreenReady;
}

async function ensureOffscreenDocumentOnce() {
  if (!hasOffscreenAPI) {
    throw new Error(
      "In-browser AI (WebLLM) is not supported in Firefox. " +
        "Please switch to Local Ollama mode in Settings.",
    );
  }

  if (await offscreenDocumentExists()) {
    offscreenReady = true;
    offscreenScriptReady = true;
    return;
  }

  offscreenReady = false;
  offscreenScriptReady = false;
  offscreenScriptReadyPromise = new Promise((resolve) => {
    _offscreenScriptReadyResolve = resolve;
  });

  // The offscreen doc (and the loaded WebLLM engine) gets torn down after
  // OFFSCREEN_IDLE_MS of inactivity, see scheduleOffscreenIdleClose. If the
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
// Prefixed by kind so a popup-stream connection can be routed without
// needing any in-memory bookkeeping to survive a worker restart.
function nextStreamId(kind) {
  return `${kind}-${crypto.randomUUID()}`;
}

// Streaming jobs for the Local Ollama backend, keyed by streamId, tracked
// independently of any popup connection: the popup closes constantly (on
// focus loss), but the job keeps running and buffering so a reopened popup
// can replay the text and keep receiving chunks.
//
// WebLLM jobs are NOT tracked here, that buffer lives in the offscreen
// document instead (see offscreen.js), because this service worker gets
// evicted after ~30s of inactivity (e.g. during a long model download with
// sparse progress ticks), which would silently wipe an in-memory Map here.
// The offscreen document has no such automatic eviction. Streams handled
// here are relayed live to/from the offscreen document instead of buffered.
const activeStreams = new Map();

// chrome.alarms, not setTimeout, timers don't survive this worker's own
// eviction (~30s of inactivity kills it, silently dropping any pending
// setTimeout). Alarms are persisted by the browser itself and wake the
// worker back up specifically to fire, so cleanup still happens even after
// a mid-stream eviction/restart. See OFFSCREEN_IDLE_ALARM below for the
// same fix applied to the offscreen-document idle-close timer.
const STREAM_CLEANUP_PREFIX = "stream-cleanup:";
const STREAM_CLEANUP_MINUTES = 2;
function scheduleStreamCleanup(streamId) {
  chrome.alarms.create(`${STREAM_CLEANUP_PREFIX}${streamId}`, {
    delayInMinutes: STREAM_CLEANUP_MINUTES,
  });
}

function broadcastToStream(stream, msg) {
  for (const port of stream.subscribers) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

// Relays a popup's stream port to the offscreen document's buffered job of
// the same streamId. This never starts or restarts generation, it only
// subscribes, replaying buffered text plus any live chunks. Used both for a
// freshly started job and for reattaching after the popup (or this worker)
// was torn down and recreated mid-stream.
function relayToOffscreenStream(popupPort, streamId) {
  const offscreenPort = chrome.runtime.connect({
    name: `offscreen-stream-${streamId}`,
  });

  let terminal = false;

  offscreenPort.onMessage.addListener((msg) => {
    if (msg.type === "done" || msg.type === "error") terminal = true;
    try {
      popupPort.postMessage(msg);
    } catch {}
  });

  offscreenPort.onDisconnect.addListener(() => {
    if (!terminal) {
      try {
        popupPort.postMessage({
          type: "error",
          error: "Connection to local model was lost",
        });
      } catch {}
    }
    try {
      popupPort.disconnect();
    } catch {}
  });

  popupPort.onDisconnect.addListener(() => {
    try {
      offscreenPort.disconnect();
    } catch {}
  });
}

// The service worker isn't bound by the extension CSP `connect-src`, so
// constrain requests to loopback hosts, otherwise a bad `host` setting could
// turn it into an SSRF fetch proxy.
const ALLOWED_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function validateOllamaHost(host) {
  let url;
  try {
    url = new URL(host);
  } catch {
    throw new Error("Invalid Ollama host");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Disallowed Ollama protocol: ${url.protocol}`);
  }
  if (!ALLOWED_OLLAMA_HOSTS.has(url.hostname)) {
    throw new Error(`Disallowed Ollama host: ${url.hostname}`);
  }
  return url.toString().replace(/\/+$/, "");
}

// Runs a summarize/ask job directly against Ollama, buffering chunks so it
// survives popup close/reopen (mirrors the WebLLM buffering, which lives in
// the offscreen document, see the activeStreams comment above).
async function startOllamaStream(
  streamId,
  { action, host, model, title, url, content, mode, question },
) {
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

  let validHost;
  try {
    validHost = validateOllamaHost(host);
  } catch (err) {
    finish({ type: "error", error: err.message });
    return;
  }

  try {
    let generator;
    if (action === "summarize") {
      generator = summarizeText({
        text: content,
        title,
        url,
        mode,
        model,
        host: validHost,
      });
    } else if (action === "ask") {
      const prompt = buildAnswerPrompt(
        title,
        url,
        truncateForPrompt(content),
        question,
      );
      generator = chatStream(validHost, model, prompt);
    } else {
      throw new Error(`Unknown ollama-stream action: ${action}`);
    }

    for await (const token of generator) {
      emitChunk(token);
    }
    finish({ type: "done" });
  } catch (err) {
    finish({ type: "error", error: err.message });
  }
}

// Shared by the "ollama-suggest-questions" message (a direct, foreground
// request) and runSuggestQuestionsJob's backgrounded job below.
async function generateOllamaSuggestions(host, model, { title, url, summary }) {
  const validHost = validateOllamaHost(host);
  const prompt = buildSuggestQuestionsPrompt(title, url, summary);
  const text = await chatOnce(validHost, model, prompt);
  return parseSuggestedQuestions(text);
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
    host,
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
      questions = await generateOllamaSuggestions(host, model, {
        title,
        url,
        summary,
      });
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
  // "generated, none" from "still pending", a missing key). When history is
  // off or the host is sensitive, keep it ephemeral and rely on the message
  // below for delivery.
  if (persist) {
    await chrome.storage.local.set({ [promptsCacheKey]: questions });
  }
  // Direct delivery to any open popup (the only path when not persisted).
  chrome.runtime
    .sendMessage({
      type: "suggested-prompts-ready",
      promptsCacheKey,
      questions,
    })
    .catch(() => {});
  pendingSuggestKeys.delete(promptsCacheKey);
}

// The Chrome action popup closes whenever it loses focus, which is constant.
// Tearing down the offscreen document (and therefore the loaded MLCEngine +
// WebGPU device) on every close forces a full model reload on the next use.
// Instead we keep it alive and only close after a period of inactivity, so
// consecutive interactions reuse the already-loaded model.
//
// This uses chrome.alarms rather than setTimeout: a plain setTimeout here
// used to just vanish whenever this worker got evicted for inactivity
// (which can happen well before the 5-minute idle window elapses, e.g.
// during a long model download with sparse progress ticks), the offscreen
// document, and the GBs of GPU/RAM its loaded model can hold, would then
// never get closed until the browser itself restarted. An alarm is
// persisted by the browser and wakes this worker back up specifically to
// fire it, so the close still happens on schedule even across an eviction.
const OFFSCREEN_IDLE_ALARM = "offscreen-idle-close";
const OFFSCREEN_IDLE_MINUTES = 5;

function cancelOffscreenIdleClose() {
  chrome.alarms.clear(OFFSCREEN_IDLE_ALARM);
}

function scheduleOffscreenIdleClose() {
  chrome.alarms.create(OFFSCREEN_IDLE_ALARM, {
    delayInMinutes: OFFSCREEN_IDLE_MINUTES,
  });
}

// The actual close, run from the alarms listener below. Split out from
// scheduling so a still-busy offscreen doc can just reschedule the alarm
// instead of recursing through a setTimeout callback.
async function closeOffscreenIfIdle() {
  // Don't close while a suggested-question job or a WebLLM stream (tracked
  // in the offscreen document itself, not here) is still running.
  let hasActiveJob = pendingSuggestKeys.size > 0;
  if (!hasActiveJob && offscreenReady) {
    try {
      const resp = await chrome.runtime.sendMessage({
        target: "offscreen",
        action: "has-active-streams",
      });
      hasActiveJob = !!resp?.active;
    } catch {
      // Offscreen document unreachable; nothing there to keep alive for.
    }
  }
  if (hasActiveJob) {
    scheduleOffscreenIdleClose();
    return;
  }
  try {
    if (typeof chrome !== "undefined" && chrome.offscreen) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    // ignore if already closed
  }
  offscreenReady = false;
  offscreenScriptReady = false;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OFFSCREEN_IDLE_ALARM) {
    closeOffscreenIfIdle();
    return;
  }
  if (alarm.name.startsWith(STREAM_CLEANUP_PREFIX)) {
    activeStreams.delete(alarm.name.slice(STREAM_CLEANUP_PREFIX.length));
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup-lifecycle") {
    // A popup is open, keep the model warm.
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

  if (streamId.startsWith("webllm-")) {
    relayToOffscreenStream(popupPort, streamId);
    return;
  }

  const stream = activeStreams.get(streamId);

  if (!stream) {
    try {
      popupPort.postMessage({
        type: "error",
        error: "Unknown or expired stream",
      });
    } catch {}
    try {
      popupPort.disconnect();
    } catch {}
    return;
  }

  // Attaching just subscribes this popup to the already-running job: replay
  // the buffered text, then stream live chunks. Disconnecting only
  // unsubscribes, it doesn't stop the job.
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
    offscreenLogs.push(
      `[${timestamp}] [${message.level.toUpperCase()}] ${message.message}`,
    );
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

          const streamId = nextStreamId("webllm");

          // The offscreen document creates the buffered job and starts it
          // immediately, independent of any popup or relay port, and
          // responds once it's registered.
          const resp = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: message.action,
            streamId,
            payload: message.payload,
          });
          if (resp?.error) throw new Error(resp.error);

          sendResponse({ streamId });
          break;
        }

        case "ollama-stream": {
          const streamId = nextStreamId("ollama");
          startOllamaStream(streamId, message.payload);
          sendResponse({ streamId });
          break;
        }

        case "ollama-status": {
          const response = await checkHealth(message.payload.host);
          sendResponse(response);
          break;
        }

        case "ollama-suggest-questions": {
          const { host, model, title, url, summary } = message.payload;
          const questions = await generateOllamaSuggestions(host, model, {
            title,
            url,
            summary,
          });
          sendResponse({ questions });
          break;
        }

        case "extract-pdf": {
          const text = await extractPdfText(message.payload.arrayBuffer);
          sendResponse({ text });
          break;
        }

        case "suggest-questions-bg": {
          // Fire and forget, the job persists its result to storage itself.
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
          // Checked directly rather than trusting offscreenReady, that
          // in-memory flag resets on every restart of this worker even
          // when the offscreen document (and whatever model it has
          // loaded) is still alive, which used to make unload silently
          // no-op right after a worker restart.
          if (!(await offscreenDocumentExists())) {
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
