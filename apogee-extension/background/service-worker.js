// Service Worker, central message router for the Apogee extension.
// Routes requests from the popup to the offscreen document (WebLLM, Chrome
// only), a local Ollama instance (talked to directly over HTTP from here),
// or, on Firefox, runs Transformers.js directly in this file.
// Firefox does not support chrome.offscreen or chrome.runtime.getContexts, so
// WebLLM (which requires an offscreen document for WebGPU) is only available
// on Chrome/Edge. Firefox instead gets in-browser inference via
// Transformers.js (ONNX/WASM, no WebGPU/offscreen/Worker needed) run
// directly in this file, since Firefox's background script, unlike
// Chrome's real service worker, runs as a background page with a
// window/DOM context and can dynamic-import it.

import { summarizeText } from "../lib/ollamaSummarize.js";
import { chatStream, chatOnce, checkHealth } from "../lib/ollamaClient.js";
import {
  buildAnswerPrompt,
  buildSuggestQuestionsPrompt,
} from "../lib/prompts.js";
import { truncateForPrompt } from "../lib/chunk.js";
import { parseSuggestedQuestions } from "../lib/questions.js";
import { extractPdfText } from "../lib/pdfExtract.js";
import {
  withTransformersEngine,
  getTransformersStatus,
  transformersChatStream,
  transformersGenerateText,
} from "../lib/transformersEngine.js";
import { getSettings } from "../lib/settings.js";
import {
  getSummaryCacheKey,
  getPromptsCacheKey,
  persistSummary,
  persistContent,
  shouldPersist,
  CACHEABLE_PAGE_TYPES,
} from "../lib/pageCache.js";
import {
  extractFromActiveTab,
  extractPdfContent,
} from "../lib/pageExtraction.js";
import { getProviderType, getModelForSettings } from "../lib/providers.js";
import { PROVIDERS } from "../lib/constants.js";
import { saveViewState } from "../lib/viewState.js";

const hasOffscreenAPI =
  typeof chrome !== "undefined" &&
  typeof chrome.offscreen !== "undefined" &&
  typeof chrome.offscreen.createDocument === "function";

let offscreenReady = false;
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
      "In-browser AI (WebLLM) needs Chrome's offscreen API, which this " +
        "browser doesn't support. Use the In-Browser (Transformers.js) or " +
        "Local Ollama provider in Settings instead.",
    );
  }

  if (await offscreenDocumentExists()) {
    offscreenReady = true;
    return;
  }

  offscreenReady = false;
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

// The service worker isn't bound by the extension CSP `connect-src` on
// Chrome (Firefox's background page fetches ARE CSP-bound), so constrain
// requests to loopback hosts ourselves, otherwise a bad `host` setting could
// turn it into an SSRF fetch proxy. Kept in exact lockstep with the
// manifest's host_permissions/CSP (http only, 127.0.0.1/localhost only):
// accepting "https:" or an IPv6 "[::1]" literal here (both used to be
// allowed) would validate but the manifest can't express/allow either (CSP
// host sources can't encode IPv6 literals), so they'd just fail at fetch
// time on Firefox anyway, no reason to accept them here either.
const ALLOWED_OLLAMA_HOSTS = new Set(["127.0.0.1", "localhost"]);

function validateOllamaHost(host) {
  let url;
  try {
    url = new URL(host);
  } catch {
    throw new Error("Invalid Ollama host");
  }
  if (url.protocol !== "http:") {
    throw new Error(`Disallowed Ollama protocol: ${url.protocol}`);
  }
  if (!ALLOWED_OLLAMA_HOSTS.has(url.hostname)) {
    throw new Error(`Disallowed Ollama host: ${url.hostname}`);
  }
  return url.toString().replace(/\/+$/, "");
}

// Narrows page content down to the passages most relevant to `question`
// (see lib/rag.js) before it goes into the Ollama answer prompt. The actual
// embedding model loads via dynamic import(), whose support inside a
// ServiceWorkerGlobalScope has been unreliable in Chrome MV3 (see the note
// in lib/embeddings.js), so the work is relayed to the offscreen document
// (a real Document context, Chrome/Edge only) the same way WebLLM's ask
// already is. Firefox has no offscreen document at
// all, so it keeps the older plain head-of-document truncation, same as
// before RAG existed, not a regression, just an unavailable enhancement.
async function getRelevantAskContent(content, question) {
  if (!hasOffscreenAPI) return truncateForPrompt(content);
  try {
    await ensureOffscreenDocument();
    const resp = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "retrieve-context",
      payload: { content, question },
    });
    if (resp?.error) throw new Error(resp.error);
    return resp.content;
  } catch (err) {
    console.error(
      "Relevant-content retrieval via offscreen failed, falling back to truncation:",
      err,
    );
    return truncateForPrompt(content);
  }
}

// Runs a summarize/ask job directly against Ollama, buffering chunks so it
// survives popup close/reopen (mirrors the WebLLM buffering, which lives in
// the offscreen document, see the activeStreams comment above).
async function startOllamaStream(
  streamId,
  { action, host, model, title, url, content, mode, question, finalize },
) {
  const stream = {
    text: "",
    done: false,
    error: null,
    cancelled: false,
    subscribers: new Set(),
    controller: new AbortController(),
  };
  activeStreams.set(streamId, stream);

  const finish = (msg) => {
    // The "cancel-stream" handler below already broadcast "cancelled" and
    // aborted the fetch; ignore whatever this job's own catch block does
    // with the resulting AbortError so it can't overwrite that with a
    // generic "error" after the fact.
    if (stream.cancelled) return;
    if (msg.type === "done") stream.done = true;
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.done = true;
    }
    broadcastToStream(stream, msg);
    scheduleStreamCleanup(streamId);
    // Persisting/suggested-questions/notification are all owned here (the
    // job producer), not by whichever popup happens to be attached when it
    // finishes, see finalizeSummaryJob's own comment for why: a popup-only
    // consumer used to silently lose the summary if closed before the job
    // finished and not reopened within the stream-cleanup window.
    if (msg.type === "done") {
      finalizeSummaryJob({ finalize, model, title, url, text: stream.text });
    }
  };

  const emitChunk = (text) => {
    if (!text || stream.cancelled) return;
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
        signal: stream.controller.signal,
      });
    } else if (action === "ask") {
      const relevantContent = await getRelevantAskContent(content, question);
      const prompt = buildAnswerPrompt(title, url, relevantContent, question);
      generator = chatStream(validHost, model, prompt, {
        signal: stream.controller.signal,
      });
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

// Runs a summarize/ask job directly against Transformers.js on Firefox,
// buffering chunks the same way startOllamaStream does above so it survives
// popup close/reopen.
async function startTransformersStream(
  streamId,
  { action, model, title, url, content, mode, question, finalize },
) {
  const stream = {
    text: "",
    done: false,
    error: null,
    cancelled: false,
    subscribers: new Set(),
    controller: new AbortController(),
  };
  activeStreams.set(streamId, stream);

  const finish = (msg) => {
    if (stream.cancelled) return;
    if (msg.type === "done") stream.done = true;
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.done = true;
    }
    broadcastToStream(stream, msg);
    scheduleStreamCleanup(streamId);
    if (msg.type === "done") {
      finalizeSummaryJob({ finalize, model, title, url, text: stream.text });
    }
  };

  const emitChunk = (text) => {
    if (!text || stream.cancelled) return;
    stream.text += text;
    broadcastToStream(stream, { type: "chunk", text });
  };

  const onProgress = (progress) => {
    chrome.runtime
      .sendMessage({ type: "model-progress", progress, modelId: model })
      .catch(() => {});
  };

  try {
    await withTransformersEngine(model, onProgress, async (eng) => {
      if (action === "summarize") {
        const generator = summarizeText(
          {
            text: content,
            title,
            url,
            mode,
            model,
            signal: stream.controller.signal,
          },
          {
            // transformers.js/ONNX has no native abort mechanism (unlike
            // WebLLM's interruptGenerate() or Ollama's fetch signal), so a
            // cancel takes effect between tokens within a chunk, and
            // summarizeText's own signal checks stop it between chunks.
            chatStreamFn: async function* (_host, _model, prompt) {
              for await (const token of transformersChatStream(eng, prompt)) {
                if (stream.cancelled) return;
                yield token;
              }
            },
            onProgress: (p) => {
              onProgress({
                progress: 0,
                text:
                  p.stage === "reduce"
                    ? "Merging summary..."
                    : `Summarizing part ${p.index + 1} of ${p.total}...`,
              });
            },
          },
        );
        for await (const token of generator) {
          emitChunk(token);
        }
      } else if (action === "ask") {
        // getRelevantAskContent already falls back to plain truncation when
        // there's no offscreen document (Firefox), same as Ollama's ask.
        const relevantContent = await getRelevantAskContent(content, question);
        const prompt = buildAnswerPrompt(title, url, relevantContent, question);
        for await (const token of transformersChatStream(eng, prompt)) {
          if (stream.cancelled) break;
          emitChunk(token);
        }
      } else {
        throw new Error(`Unknown transformers-stream action: ${action}`);
      }
    });
    finish({ type: "done" });
  } catch (err) {
    // Not every rejection here is a plain Error, and a falsy `error` here
    // renders as the unhelpful generic "Unknown error during streaming" in
    // lib/providers.js's attachToStream.
    finish({ type: "error", error: err?.message || String(err) });
  }
}

async function generateTransformersSuggestions(model, { title, url, summary }) {
  return withTransformersEngine(model, null, async (eng) => {
    const prompt = buildSuggestQuestionsPrompt(title, url, summary);
    const text = await transformersGenerateText(eng, prompt);
    return parseSuggestedQuestions(text);
  });
}

// Runs a full summarize job for `tab` with no popup involved at all: the
// context-menu entry and the keyboard shortcut (see chrome.contextMenus/
// chrome.commands listeners below) both call this. Mirrors popup.js's
// summarizeActivePage() (always re-extracts live, same as that function
// does, rather than reusing getPageData()'s in-memory-reuse path, which
// only exists for follow-up questions), but starts generation in-process
// here, direct calls/an internal message to the offscreen document, rather
// than routing through this same worker's own onMessage handler the way a
// popup-triggered job does. finalizeSummaryJob (wired into every
// generation path's own completion) persists the result and generates
// suggested questions once it's done, whether or not a popup ever opens.
async function runBackgroundSummarize(tab, { notifyOnFinish }) {
  const settings = await getSettings();
  const providerType = getProviderType(settings);
  const model = getModelForSettings(settings);

  const pageData = await extractFromActiveTab(tab);
  if (!pageData) return;
  // Gmail returns empty content when no thread is open; nothing sensible
  // to summarize there, same check summarizeActivePage makes.
  if (!pageData.isPdf && !pageData.content) return;

  if (
    CACHEABLE_PAGE_TYPES.has(pageData.type) &&
    (await shouldPersist(tab.url))
  ) {
    await persistContent(tab.url, pageData);
  }

  let content = pageData.content;
  if (pageData.isPdf) {
    content = await extractPdfContent(tab);
    if (!content) return;
  }

  const finalize = {
    cacheKey: getSummaryCacheKey(tab.url, settings.responseFormat, model),
    promptsCacheKey: getPromptsCacheKey(
      tab.url,
      settings.responseFormat,
      model,
    ),
    persist: await shouldPersist(tab.url),
    providerType,
    host: settings.ollamaHost,
    notifyOnFinish,
    tabId: tab.id,
    windowId: tab.windowId,
  };

  const common = {
    action: "summarize",
    title: pageData.title,
    url: pageData.url,
    content,
    mode: settings.responseFormat,
    model,
    finalize,
  };

  let streamId;
  if (providerType === PROVIDERS.LOCAL) {
    streamId = nextStreamId("ollama");
    // Not awaited: startOllamaStream runs synchronously up to its own
    // first `await` (standard JS async-function semantics), which is
    // *after* it registers the stream in activeStreams, so by the time
    // this line returns the registration below is safe to rely on.
    startOllamaStream(streamId, { ...common, host: settings.ollamaHost });
  } else if (providerType === PROVIDERS.TRANSFORMERS) {
    streamId = nextStreamId("transformers");
    startTransformersStream(streamId, common);
  } else {
    // WebLLM: generation runs in the offscreen document, not here. Awaited
    // (unlike the two branches above) because the stream is only
    // registered on the *other side* of this message, in offscreen.js's
    // own `streams` map, synchronously before it responds, so awaiting
    // the response is what guarantees that registration has happened by
    // the time saveViewState below runs.
    await ensureOffscreenDocument();
    streamId = nextStreamId("webllm");
    const resp = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "summarize",
      streamId,
      payload: common,
    });
    if (resp?.error) throw new Error(resp.error);
  }

  // Mark this tab as "summarizing" with the real streamId, now that the
  // job is confirmed registered wherever it actually runs. This is what
  // lets the popup, if opened at any point while this job is in flight,
  // show the loading/summarizing view (rotating verb, spinner) and
  // reattach to the live stream via attachToStream, exactly the same
  // reattachment path an already-open popup already uses for a
  // popup-triggered summarize, instead of the default home page with no
  // indication anything is happening.
  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "summarizing",
    url: tab.url,
    streamId,
    promptsCacheKey: finalize.promptsCacheKey,
  });
}

// Best-effort failure notice for a background-triggered summarize: nothing
// else observes runBackgroundSummarize's rejection (no popup necessarily
// open), so without this a failed context-menu/shortcut summarize just
// fails silently. Reuses notificationTargets/the shared onClicked listener
// above so clicking it still focuses the right tab.
function notifyJobFailed(err, tab) {
  console.error("Background summarize failed:", err);
  if (typeof chrome.notifications === "undefined") return;
  const notificationId = `apogee-summary-error-${crypto.randomUUID()}`;
  notificationTargets.set(notificationId, {
    tabId: tab?.id,
    windowId: tab?.windowId,
  });
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-96.png"),
    title: "Summarize failed",
    message: err?.message || "Something went wrong summarizing this page.",
  });
}

const SUMMARIZE_CONTEXT_MENU_ID = "apogee-summarize";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: SUMMARIZE_CONTEXT_MENU_ID,
    title: "Summarize this page",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SUMMARIZE_CONTEXT_MENU_ID || !tab) return;
  runBackgroundSummarize(tab, { notifyOnFinish: true }).catch((err) =>
    notifyJobFailed(err, tab),
  );
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "summarize-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  runBackgroundSummarize(tab, { notifyOnFinish: true }).catch((err) =>
    notifyJobFailed(err, tab),
  );
});

// SponsorBlock categories we strip from YouTube transcripts before
// summarizing: paid sponsor reads, unpaid self-promotion (merch/Patreon
// plugs), and subscribe/interaction reminders.
const SPONSORBLOCK_CATEGORIES = ["sponsor", "selfpromo", "interaction"];

// Fetches sponsor-segment time ranges for a YouTube video from SponsorBlock's
// privacy-preserving hashed endpoint: only the first 4 hex chars of the
// SHA-256 of the video id are sent, so the server returns a whole bucket of
// videos and never learns which one is being summarized (we match ours
// locally). Returns [[startSec, endSec], ...]; [] on any failure, which makes
// the caller fall back to its local phrase heuristic.
async function fetchSponsorBlockSegments(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) return [];

  const bytes = new TextEncoder().encode(videoId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashHex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const prefix = hashHex.slice(0, 4);

  const categories = encodeURIComponent(
    JSON.stringify(SPONSORBLOCK_CATEGORIES),
  );
  const url = `https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${categories}`;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    return [];
  }
  if (!res.ok) return []; // 404 == no segments for this hash prefix

  let data;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const entry = Array.isArray(data)
    ? data.find((d) => d.videoID === videoId || d.hash === hashHex)
    : null;
  if (!entry || !Array.isArray(entry.segments)) return [];

  return entry.segments
    .filter(
      (s) =>
        SPONSORBLOCK_CATEGORIES.includes(s.category) &&
        Array.isArray(s.segment) &&
        s.segment.length === 2,
    )
    .map((s) => [s.segment[0], s.segment[1]]);
}

// Used by runSuggestQuestionsJob's backgrounded job below.
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

  // The delete lives in a finally: if anything past generation throws (e.g.
  // the storage write hitting quota), a key left behind in the Set would
  // block regeneration for that page until this worker restarts.
  try {
    let questions = [];
    try {
      if (providerType === "local") {
        questions = await generateOllamaSuggestions(host, model, {
          title,
          url,
          summary,
        });
      } else if (providerType === "transformers") {
        // Transformers.js only ever runs on Firefox (see PROVIDERS in
        // lib/constants.js), always in-process, never via the offscreen
        // document.
        questions = await generateTransformersSuggestions(model, {
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
  } finally {
    pendingSuggestKeys.delete(promptsCacheKey);
  }
}

// Owns "a summarize job finished, now what" for every trigger source (popup
// click, context menu, keyboard shortcut): persist the result and kick off
// suggested questions, exactly once, regardless of whether any popup is (or
// ever was) attached to watch it stream. This used to live in popup.js's
// consumeSummaryStream instead, which meant a summary was only ever saved
// if the popup stayed open long enough to drain the stream, closing it
// early lost the finished result once the stream buffer's cleanup alarm
// fired (a couple of minutes later, see scheduleStreamCleanup). Called from
// startOllamaStream/startTransformersStream's own `finish()` directly
// (same context, no round-trip needed), and via the "stream-finished"
// message below for the WebLLM/offscreen path, which runs in a different
// document and has to notify this one proactively.
//
// `finalize` is undefined for "ask" jobs (only summarize.summarize() passes
// it, see lib/providers.js) and for a cancelled job (finish()/emit() both
// return before reaching the "done" branch that calls this once cancelled,
// see their own comments), so this never persists a partial/irrelevant
// result.
async function finalizeSummaryJob({ finalize, model, title, url, text }) {
  if (!finalize) return;
  const {
    cacheKey,
    promptsCacheKey,
    persist,
    providerType,
    host,
    notifyOnFinish,
    tabId,
    windowId,
  } = finalize;

  if (persist) {
    await persistSummary(cacheKey, promptsCacheKey, text, title);
  }
  // Fire-and-forget: runSuggestQuestionsJob already handles its own
  // persist-vs-not branching and popup notification.
  runSuggestQuestionsJob({
    promptsCacheKey,
    persist,
    providerType,
    host,
    title,
    url,
    summary: text,
    model,
  });
  if (notifyOnFinish) {
    notifyJobComplete({ title, tabId, windowId });
  }
}

// tabId/windowId to focus per open notification, so notifications.onClicked
// (which only gives back a notification id) can bring the right tab/window
// forward. Only needs to survive until the notification is clicked or this
// worker is evicted; a missed click just does nothing extra, not a crash.
const notificationTargets = new Map();

function notifyJobComplete({ title, tabId, windowId }) {
  if (typeof chrome.notifications === "undefined") return;
  const notificationId = `apogee-summary-${crypto.randomUUID()}`;
  notificationTargets.set(notificationId, { tabId, windowId });
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-96.png"),
    title: "Summary ready",
    message: title ? `"${title}" is ready to view.` : "Click to view it.",
  });
}

// "notifications" is always declared in manifest.json now, so this should
// always exist, but the same typeof guard notifyJobComplete/notifyJobFailed
// use is worth keeping here too, `chrome.notifications?.onClicked` alone
// would still throw calling .addListener on undefined if it somehow didn't.
if (typeof chrome.notifications !== "undefined") {
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    const target = notificationTargets.get(notificationId);
    notificationTargets.delete(notificationId);
    chrome.notifications.clear(notificationId);
    if (!target) return;

    // Always bring the source tab/window forward, this alone is a
    // reasonable outcome (the user can click the toolbar icon from there).
    // openPopup() below is a best-effort enhancement on top, not a
    // requirement.
    try {
      if (target.windowId != null) {
        await chrome.windows.update(target.windowId, { focused: true });
      }
      if (target.tabId != null) {
        await chrome.tabs.update(target.tabId, { active: true });
      }
    } catch {
      // Tab/window may have been closed since the notification was created.
    }

    // chrome.action.openPopup() landed in Chrome 127; this manifest's
    // minimum_chrome_version (109) explicitly supports older versions that
    // don't have it at all, so this has to be a feature-detected
    // enhancement, never a requirement the tab-focus fallback above
    // depends on.
    if (typeof chrome.action?.openPopup === "function") {
      try {
        await chrome.action.openPopup();
      } catch {
        // Can throw if the window isn't focused/is minimized/etc.; the
        // tab-focus fallback above already ran, nothing more to do here.
      }
    }
  });
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
  if (stream.cancelled) {
    try {
      popupPort.postMessage({ type: "cancelled" });
    } catch {}
  } else if (stream.error) {
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

  // Proactive completion notice from the offscreen document's runStream
  // (WebLLM/Chrome path only): that job runs in a different document, so it
  // can't call finalizeSummaryJob directly the way startOllamaStream/
  // startTransformersStream do in this same file, it has to tell this
  // worker instead. Fire-and-forget, same shape as model-progress/
  // offscreen-log above; only sent when the job actually carries a
  // `finalize` (summarize jobs started with one, see runStream's emit()).
  if (message.type === "stream-finished") {
    if (message.error) return false;
    finalizeSummaryJob({
      finalize: message.finalize,
      model: message.model,
      title: message.title,
      url: message.url,
      text: message.text,
    });
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
          // responds once it's registered. For "ask", it also narrows the
          // content down to the passages most relevant to the question
          // itself (see lib/rag.js), since that requires the same
          // dynamic-import-capable document context WebLLM already runs in
          // (dynamic import() in this file's ServiceWorkerGlobalScope has
          // been unreliable in Chrome MV3, see lib/embeddings.js).
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

        case "cancel-stream": {
          const { streamId } = message.payload;
          if (streamId.startsWith("webllm-")) {
            // The job and its buffer live in the offscreen document, not
            // here (see the activeStreams comment above), so cancellation
            // has to be relayed there too.
            chrome.runtime
              .sendMessage({
                target: "offscreen",
                action: "cancel-stream",
                payload: { streamId },
              })
              .catch(() => {});
          } else {
            const stream = activeStreams.get(streamId);
            if (stream && !stream.done) {
              stream.cancelled = true;
              stream.done = true;
              broadcastToStream(stream, { type: "cancelled" });
              scheduleStreamCleanup(streamId);
              try {
                stream.controller?.abort();
              } catch {}
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case "ollama-status": {
          // Same loopback-only rule as every other Ollama-touching handler
          // (see validateOllamaHost above); this probe used to skip it,
          // letting an arbitrary saved host be fetched on every popup open.
          // An invalid host just reads as "disconnected" rather than an
          // error, matching how the popup treats an unreachable Ollama.
          let validHost;
          try {
            validHost = validateOllamaHost(message.payload.host);
          } catch {
            sendResponse({ connected: false, models: [] });
            break;
          }
          const response = await checkHealth(validHost);
          sendResponse(response);
          break;
        }

        // Transformers.js only ever runs on Firefox (see PROVIDERS in
        // lib/constants.js), always in-process here, never via an offscreen
        // document. message.payload.action ("summarize" or "ask") tells this
        // which job to run, same wrapper convention as "ollama-stream" above.
        case "transformers-stream": {
          const streamId = nextStreamId("transformers");
          startTransformersStream(streamId, message.payload);
          sendResponse({ streamId });
          break;
        }

        case "transformers-status": {
          const { currentModelId, loadingModelId } = getTransformersStatus();
          sendResponse({
            // Mirrors WebLLM's "status" (offscreen.js): `ready` reflects
            // the runtime capability (WASM here, WebGPU there), not whether
            // a model is already downloaded/loaded.
            ready: typeof WebAssembly !== "undefined",
            currentModel: currentModelId,
            loading: loadingModelId,
          });
          break;
        }

        case "extract-pdf": {
          const text = await extractPdfText(message.payload.arrayBuffer);
          sendResponse({ text });
          break;
        }

        case "sponsorblock-segments": {
          const segments = await fetchSponsorBlockSegments(
            message.payload.videoId,
          );
          sendResponse({ segments });
          break;
        }

        case "suggest-questions-bg": {
          // Fire and forget, the job persists its result to storage itself.
          runSuggestQuestionsJob(message.payload);
          sendResponse({ started: true });
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

        // "Highlight in page": relays to the offscreen document's
        // findBestPassage (see lib/rag.js), same embedding-model/
        // offscreen-document dependency as the "ask" RAG path
        // (getRelevantAskContent above), so Chromium only, same as that.
        case "find-passage": {
          if (!hasOffscreenAPI) {
            sendResponse({
              error:
                "Highlight-in-page needs the offscreen document (Chrome/Edge only).",
            });
            break;
          }
          await ensureOffscreenDocument();
          const response = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "find-passage",
            payload: message.payload,
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
