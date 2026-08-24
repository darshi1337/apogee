import { summarizeText } from "../lib/summarize/ollamaSummarize.js";
import { resolveEffectiveLanguage } from "../lib/language/detectLanguage.js";
import {
  streamInTargetLanguage,
  generateInTargetLanguage,
} from "../lib/language/languageOutput.js";
import { makeOpusTranslateFn } from "../lib/language/opusTranslateEngine.js";
import { chatStream, checkHealth } from "../lib/engines/ollamaClient.js";
import { errorHelpUrl } from "../lib/util/errorHelp.js";
import { toUserMessage } from "../lib/util/userError.js";
import {
  buildAnswerPrompt,
  buildSuggestQuestionsPrompt,
  withCustomInstructions,
} from "../lib/summarize/prompts.js";
import { truncateForPrompt } from "../lib/summarize/chunk.js";
import { parseSuggestedQuestions } from "../lib/summarize/questions.js";
import { extractPdfText } from "../lib/extract/pdfExtract.js";
import {
  withTransformersEngine,
  getTransformersStatus,
  transformersChatStream,
} from "../lib/engines/transformersEngine.js";
import { getSettings } from "../lib/storage/settings.js";
import { initDebugLogging } from "../lib/util/log.js";
import {
  getSummaryCacheKey,
  getPromptsCacheKey,
  persistSummaryIfAllowed,
  persistContent,
  shouldPersist,
  isPrivateUrl,
  CACHEABLE_PAGE_TYPES,
} from "../lib/storage/pageCache.js";
import {
  extractFromActiveTab,
  extractPdfContent,
} from "../lib/extract/pageExtraction.js";
import {
  getProviderType,
  getModelForSettings,
} from "../lib/engines/providers.js";
import { PROVIDERS, TRANSLATION_ENGINES } from "../lib/constants.js";
import { saveViewState, removeViewState } from "../lib/storage/viewState.js";

initDebugLogging();

const hasOffscreenAPI =
  typeof chrome !== "undefined" &&
  typeof chrome.offscreen !== "undefined" &&
  typeof chrome.offscreen.createDocument === "function";

let offscreenReady = false;
const offscreenLogs = [];

let popupConnected = false;

let _offscreenScriptReadyResolve = null;
let offscreenScriptReadyPromise = new Promise((resolve) => {
  _offscreenScriptReadyResolve = resolve;
});

let ensureOffscreenPromise = null;

function ensureOffscreenDocument() {
  if (!ensureOffscreenPromise) {
    ensureOffscreenPromise = ensureOffscreenDocumentOnce().finally(() => {
      ensureOffscreenPromise = null;
    });
  }
  return ensureOffscreenPromise;
}

async function offscreenDocumentExists() {
  if (!hasOffscreenAPI) return false;
  if (typeof chrome.runtime.getContexts === "function") {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen/offscreen.html")],
    });
    return existingContexts.length > 0;
  }
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
    if (!popupConnected) scheduleOffscreenIdleClose();
    return;
  }

  offscreenReady = false;
  offscreenScriptReadyPromise = new Promise((resolve) => {
    _offscreenScriptReadyResolve = resolve;
  });

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

  await Promise.race([
    offscreenScriptReadyPromise,
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);

  if (!popupConnected) scheduleOffscreenIdleClose();
}

function nextStreamId(kind) {
  return `${kind}-${crypto.randomUUID()}`;
}

function isOffscreenStream(streamId) {
  return (
    hasOffscreenAPI &&
    (streamId.startsWith("webllm-") || streamId.startsWith("transformers-"))
  );
}

const activeStreams = new Map();

const STREAM_CLEANUP_PREFIX = "stream-cleanup:";
const STREAM_CLEANUP_MINUTES = 2;
function scheduleStreamCleanup(streamId) {
  chrome.alarms.create(`${STREAM_CLEANUP_PREFIX}${streamId}`, {
    delayInMinutes: STREAM_CLEANUP_MINUTES,
  });
}

const KEEPALIVE_MS = 20000;
let keepAliveTimer = null;

function hasWorkInFlight() {
  for (const stream of activeStreams.values()) {
    if (!stream.done) return true;
  }
  return pendingSuggestKeys.size > 0;
}

function startKeepAlive() {
  if (keepAliveTimer !== null) return;
  keepAliveTimer = setInterval(() => {
    if (!hasWorkInFlight()) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      return;
    }
    try {
      chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
    } catch {}
  }, KEEPALIVE_MS);
}

function broadcastToStream(stream, msg) {
  for (const port of stream.subscribers) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

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

function createBufferedStream(streamId, { finalize, model, title, url }) {
  const stream = {
    text: "",
    done: false,
    error: null,
    cancelled: false,
    subscribers: new Set(),
    controller: new AbortController(),
  };
  activeStreams.set(streamId, stream);
  startKeepAlive();

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

  return { stream, finish, emitChunk };
}

async function startOllamaStream(
  streamId,
  {
    action,
    host,
    model,
    title,
    url,
    content,
    mode,
    type,
    question,
    finalize,
    language,
    translationEngine,
  },
) {
  const { stream, finish, emitChunk } = createBufferedStream(streamId, {
    finalize,
    model,
    title,
    url,
  });

  let validHost;
  try {
    validHost = validateOllamaHost(host);
  } catch (err) {
    finish({ type: "error", error: err.message });
    return;
  }

  const { customInstructions } = await getSettings();

  let longNote = "";
  const reportProgress = (text) => {
    chrome.runtime
      .sendMessage({
        type: "model-progress",
        progress: { progress: 0, text },
        modelId: model,
      })
      .catch(() => {});
  };

  const translateFn =
    translationEngine === TRANSLATION_ENGINES.OPUS
      ? makeOpusTranslateFn((p) => reportProgress(p.text))
      : undefined;

  try {
    let generator;
    if (action === "summarize") {
      generator = summarizeText(
        {
          text: content,
          title,
          url,
          mode,
          type,
          model,
          language: await resolveEffectiveLanguage(content, language),
          customInstructions,
          host: validHost,
          signal: stream.controller.signal,
        },
        {
          translateFn,
          onProgress: (p) => {
            if (p.stage === "truncated") {
              longNote = "Long page - summarizing the key parts. ";
              reportProgress(longNote.trim());
              return;
            }
            if (p.stage === "reduce")
              reportProgress(`${longNote}Merging summary...`);
            else if (p.stage === "translate")
              reportProgress(`${longNote}Translating...`);
            else
              reportProgress(
                `${longNote}Summarizing part ${p.index + 1} of ${p.total}...`,
              );
          },
        },
      );
    } else if (action === "ask") {
      const relevantContent = await getRelevantAskContent(content, question);
      const prompt = withCustomInstructions(
        buildAnswerPrompt(title, url, relevantContent, question),
        customInstructions,
      );
      const chat = (p, opts) => chatStream(validHost, model, p, opts);
      generator = streamInTargetLanguage(
        chat,
        prompt,
        await resolveEffectiveLanguage(content, language),
        { signal: stream.controller.signal, translateFn },
      );
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

async function startTransformersStream(
  streamId,
  {
    action,
    model,
    title,
    url,
    content,
    mode,
    type,
    question,
    finalize,
    language,
    translationEngine,
  },
) {
  const { stream, finish, emitChunk } = createBufferedStream(streamId, {
    finalize,
    model,
    title,
    url,
  });

  const onProgress = (progress) => {
    chrome.runtime
      .sendMessage({ type: "model-progress", progress, modelId: model })
      .catch(() => {});
  };

  const translateFn =
    translationEngine === TRANSLATION_ENGINES.OPUS
      ? makeOpusTranslateFn((p) =>
          onProgress({ progress: p.progress ?? 0, text: p.text }),
        )
      : undefined;

  let longNote = "";
  let stageLabel = "Summarizing...";

  const { customInstructions } = await getSettings();

  try {
    await withTransformersEngine(model, onProgress, async (eng) => {
      if (action === "summarize") {
        const effectiveLanguage = await resolveEffectiveLanguage(
          content,
          language,
        );
        const generator = summarizeText(
          {
            text: content,
            title,
            url,
            mode,
            type,
            model,
            language: effectiveLanguage,
            customInstructions,
            signal: stream.controller.signal,
          },
          {
            translateFn,
            chatStreamFn: async function* (_host, _model, prompt, opts) {
              let count = 0;
              for await (const token of transformersChatStream(eng, prompt, {
                system: opts?.system,
              })) {
                if (stream.cancelled) return;
                count++;
                if (count % 24 === 0) {
                  onProgress({
                    progress: 0,
                    text: `${longNote}${stageLabel} (${count} words)`,
                  });
                }
                yield token;
              }
            },
            onProgress: (p) => {
              if (p.stage === "truncated") {
                longNote = "Long page - summarizing the key parts. ";
                onProgress({ progress: 0, text: longNote.trim() });
                return;
              }
              if (p.stage === "reduce") stageLabel = "Merging summary...";
              else if (p.stage === "translate") stageLabel = "Translating...";
              else
                stageLabel = `Summarizing part ${p.index + 1} of ${p.total}...`;
              onProgress({ progress: 0, text: longNote + stageLabel });
            },
          },
        );
        for await (const token of generator) {
          emitChunk(token);
        }
      } else if (action === "ask") {
        const relevantContent = await getRelevantAskContent(content, question);
        const prompt = withCustomInstructions(
          buildAnswerPrompt(title, url, relevantContent, question),
          customInstructions,
        );
        const chat = (p, opts) =>
          transformersChatStream(eng, p, { system: opts?.system });
        const askLanguage = await resolveEffectiveLanguage(content, language);
        for await (const token of streamInTargetLanguage(
          chat,
          prompt,
          askLanguage,
          {
            signal: stream.controller.signal,
            translateFn,
          },
        )) {
          if (stream.cancelled) break;
          emitChunk(token);
        }
      } else {
        throw new Error(`Unknown transformers-stream action: ${action}`);
      }
    });
    finish({ type: "done" });
  } catch (err) {
    finish({ type: "error", error: err?.message || String(err) });
  }
}

async function generateTransformersSuggestions(
  model,
  { title, url, summary, language, translationEngine },
) {
  return withTransformersEngine(model, null, async (eng) => {
    const prompt = buildSuggestQuestionsPrompt(title, url, summary);
    const chat = (p, opts) =>
      transformersChatStream(eng, p, { system: opts?.system });
    const qLanguage = await resolveEffectiveLanguage(summary, language);
    const translateFn =
      translationEngine === TRANSLATION_ENGINES.OPUS
        ? makeOpusTranslateFn(() => {})
        : undefined;
    const text = await generateInTargetLanguage(chat, prompt, qLanguage, {
      translateFn,
    });
    return parseSuggestedQuestions(text);
  });
}

async function runBackgroundSummarize(
  tab,
  { notifyOnFinish, selectionText } = {},
) {
  const settings = await getSettings();
  const providerType = getProviderType(settings);
  const model = getModelForSettings(settings);

  const selection = selectionText ? selectionText.trim() : "";
  const isSelection = selection.length > 0;

  let pageData;
  if (isSelection) {
    pageData = {
      title: tab.title || "Selected text",
      url: tab.url,
      content: selection,
      type: "generic",
      isPdf: false,
    };
  } else {
    pageData = await extractFromActiveTab(tab);
    if (!pageData) {
      if (notifyOnFinish) {
        notifyNothingToSummarize(
          "Couldn't read this page. Try reloading it, or pick a different tab.",
        );
      }
      return;
    }
    if (!pageData.isPdf && !pageData.content) {
      if (notifyOnFinish) {
        notifyNothingToSummarize(
          "Nothing to summarize here yet - open a page, email, or video first.",
        );
      }
      return;
    }
  }

  const persist = isSelection ? false : await shouldPersist(tab.url);
  const cacheUrl = isSelection ? `${tab.url}#apogee-selection` : tab.url;

  if (!isSelection && CACHEABLE_PAGE_TYPES.has(pageData.type) && persist) {
    await persistContent(tab.url, pageData);
  }

  let content = pageData.content;
  if (pageData.isPdf) {
    try {
      content = await extractPdfContent(tab);
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.startsWith("PDF_TOO_LARGE:")) {
        if (notifyOnFinish) {
          notifyNothingToSummarize(
            "This PDF is too large to process inside the extension. Try a shorter document.",
          );
        }
        return;
      }
      throw err;
    }
    if (!content) {
      if (notifyOnFinish) {
        notifyNothingToSummarize(
          "Couldn't pull any text out of this PDF - it might be a scanned image.",
        );
      }
      return;
    }
  }

  const finalize = {
    cacheKey: await getSummaryCacheKey(
      cacheUrl,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
      settings.customInstructions,
      settings.translationEngine,
    ),
    promptsCacheKey: await getPromptsCacheKey(
      cacheUrl,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
      settings.customInstructions,
      settings.translationEngine,
    ),
    persist,
    persistUrl: tab.url,
    isSelection,
    providerType,
    host: settings.ollamaHost,
    notifyOnFinish,
    language: settings.summaryLanguage,
    translationEngine: settings.translationEngine,
    sensitive: await isPrivateUrl(tab.url, settings),
    tabId: tab.id,
    windowId: tab.windowId,
  };

  const common = {
    action: "summarize",
    title: pageData.title,
    url: pageData.url,
    content,
    mode: settings.responseFormat,
    type: pageData.type,
    model,
    language: settings.summaryLanguage,
    translationEngine: settings.translationEngine,
    customInstructions: settings.customInstructions,
    finalize,
  };

  let streamId;
  if (providerType === PROVIDERS.LOCAL) {
    streamId = nextStreamId("ollama");
    startOllamaStream(streamId, { ...common, host: settings.ollamaHost });
  } else if (providerType === PROVIDERS.TRANSFORMERS) {
    streamId = nextStreamId("transformers");
    startTransformersStream(streamId, common);
  } else {
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

  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "summarizing",
    url: tab.url,
    streamId,
    promptsCacheKey: finalize.promptsCacheKey,
    summaryLanguage: settings.summaryLanguage,
    translationEngine: settings.translationEngine,
  });
}

function notifyJobFailed(err) {
  console.error("Background summarize failed:", err);
  if (typeof chrome.notifications === "undefined") return;
  const message = toUserMessage(err);
  const notificationId = `apogee-summary-error-${crypto.randomUUID()}`;
  // A notification body cannot hold a link, so clicking it opens the
  // explanation instead of focusing the tab.
  notificationTargets.set(notificationId, { helpUrl: errorHelpUrl(message) });
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-96.png"),
    title: "Summarize failed",
    message: `${message} Click to see what this means.`,
  });
}

const SUMMARIZE_CONTEXT_MENU_ID = "apogee-summarize";
const SUMMARIZE_SELECTION_CONTEXT_MENU_ID = "apogee-summarize-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: SUMMARIZE_CONTEXT_MENU_ID,
    title: "Summarize this page",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: SUMMARIZE_SELECTION_CONTEXT_MENU_ID,
    title: "Summarize selection",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === SUMMARIZE_CONTEXT_MENU_ID) {
    runBackgroundSummarize(tab, { notifyOnFinish: true }).catch((err) =>
      notifyJobFailed(err),
    );
  } else if (info.menuItemId === SUMMARIZE_SELECTION_CONTEXT_MENU_ID) {
    runBackgroundSummarize(tab, {
      notifyOnFinish: true,
      selectionText: info.selectionText,
    }).catch((err) => notifyJobFailed(err));
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "summarize-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  runBackgroundSummarize(tab, { notifyOnFinish: true }).catch((err) =>
    notifyJobFailed(err),
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeViewState(tabId).catch(() => {});
});

const SPONSORBLOCK_CATEGORIES = ["sponsor", "selfpromo", "interaction"];

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
  if (!res.ok) return [];

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

async function fetchBilibiliSubtitles({ aid, bvid, cid, preferredLang }) {
  if (!cid || (!aid && !bvid)) return [];
  const cidStr = String(cid);
  if (!/^\d+$/.test(cidStr)) return [];
  const params = new URLSearchParams({ cid: cidStr });
  if (bvid && /^BV[0-9A-Za-z]{10}$/.test(bvid)) params.set("bvid", bvid);
  else if (aid && /^\d+$/.test(String(aid))) params.set("aid", String(aid));
  else return [];

  let listRes;
  try {
    listRes = await fetch(
      `https://api.bilibili.com/x/player/v2?${params.toString()}`,
      { credentials: "include", signal: AbortSignal.timeout(6000) },
    );
  } catch {
    return [];
  }
  if (!listRes.ok) return [];

  let listData;
  try {
    listData = await listRes.json();
  } catch {
    return [];
  }

  const subtitles = listData?.data?.subtitle?.subtitles;
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];

  const langPrefix = (preferredLang || "").split("-")[0].toLowerCase();
  const chosen =
    subtitles.find((s) =>
      (s.lan || "").toLowerCase().replace(/^ai-/, "").startsWith(langPrefix),
    ) || subtitles[0];

  let subUrl = chosen?.subtitle_url;
  if (!subUrl) return [];
  if (subUrl.startsWith("//")) subUrl = `https:${subUrl}`;
  let host;
  try {
    host = new URL(subUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  if (host !== "hdslb.com" && !host.endsWith(".hdslb.com")) return [];

  let subRes;
  try {
    subRes = await fetch(subUrl, { signal: AbortSignal.timeout(6000) });
  } catch {
    return [];
  }
  if (!subRes.ok) return [];

  let subData;
  try {
    subData = await subRes.json();
  } catch {
    return [];
  }

  const body = subData?.body;
  if (!Array.isArray(body)) return [];
  return body
    .map((seg) => ({
      start: Number(seg.from) || 0,
      text: String(seg.content || "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((seg) => seg.text);
}

async function generateOllamaSuggestions(
  host,
  model,
  { title, url, summary, language, translationEngine },
) {
  const validHost = validateOllamaHost(host);
  const prompt = buildSuggestQuestionsPrompt(title, url, summary);
  const chat = (p, opts) => chatStream(validHost, model, p, opts);
  const qLanguage = await resolveEffectiveLanguage(summary, language);
  const translateFn =
    translationEngine === TRANSLATION_ENGINES.OPUS
      ? makeOpusTranslateFn(() => {})
      : undefined;
  const text = await generateInTargetLanguage(chat, prompt, qLanguage, {
    translateFn,
  });
  return parseSuggestedQuestions(text);
}

const pendingSuggestKeys = new Set();

async function runSuggestQuestionsJob(payload) {
  const {
    promptsCacheKey,
    persist = true,
    persistUrl,
    providerType,
    host,
    title,
    url,
    summary,
    model,
    language,
    translationEngine,
  } = payload || {};
  if (!promptsCacheKey || pendingSuggestKeys.has(promptsCacheKey)) return;
  pendingSuggestKeys.add(promptsCacheKey);
  startKeepAlive();

  try {
    let questions = [];
    try {
      if (providerType === PROVIDERS.LOCAL) {
        questions = await generateOllamaSuggestions(host, model, {
          title,
          url,
          summary,
          language,
          translationEngine,
        });
      } else if (providerType === PROVIDERS.TRANSFORMERS && !hasOffscreenAPI) {
        questions = await generateTransformersSuggestions(model, {
          title,
          url,
          summary,
          language,
          translationEngine,
        });
      } else {
        await ensureOffscreenDocument();
        const resp = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "suggest-questions",
          payload: {
            title,
            url,
            summary,
            model,
            language,
            translationEngine,
            provider:
              providerType === PROVIDERS.TRANSFORMERS
                ? "transformers"
                : "webllm",
          },
        });
        questions = resp?.questions || [];
      }
    } catch {
      questions = [];
    }

    // Generating the questions takes its own trip through the model, so the
    // setting gets one more look before this write too.
    if (persist && (await shouldPersist(persistUrl || url))) {
      await chrome.storage.local.set({ [promptsCacheKey]: questions });
    }
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

async function finalizeSummaryJob({ finalize, model, title, url, text }) {
  if (!finalize) return;
  const {
    cacheKey,
    promptsCacheKey,
    persist,
    persistUrl,
    isSelection,
    providerType,
    host,
    notifyOnFinish,
    sensitive,
    tabId,
    windowId,
    language,
    translationEngine,
  } = finalize;

  // `persist` is what was true when the job started. The write only happens if
  // it is still true now, so turning history off mid-generation also excludes
  // the summary that is running.
  const persisted =
    persist &&
    (await persistSummaryIfAllowed(
      persistUrl || url,
      cacheKey,
      promptsCacheKey,
      text,
      title,
    ));

  if (!persisted && isSelection) {
    await saveViewState(tabId, {
      view: "summaryView",
      subview: "summary",
      url,
      streamId: null,
      summaryText: text,
      promptsCacheKey,
      summaryLanguage: language,
      translationEngine,
    });
  }
  runSuggestQuestionsJob({
    promptsCacheKey,
    persist: persisted,
    persistUrl: persistUrl || url,
    providerType,
    host,
    title,
    url,
    summary: text,
    model,
    language,
    translationEngine,
  });
  if (notifyOnFinish) {
    notifyJobComplete({ title: sensitive ? "" : title, tabId, windowId });
  }
}

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

function notifyNothingToSummarize(message) {
  if (typeof chrome.notifications === "undefined") return;
  const notificationId = `apogee-summary-empty-${crypto.randomUUID()}`;
  notificationTargets.set(notificationId, { helpUrl: errorHelpUrl(message) });
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-96.png"),
    title: "Nothing to summarize",
    message: `${message} Click to see what this means.`,
  });
}

if (typeof chrome.notifications !== "undefined") {
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    const target = notificationTargets.get(notificationId);
    notificationTargets.delete(notificationId);
    chrome.notifications.clear(notificationId);
    if (!target) return;

    if (target.helpUrl) {
      await chrome.tabs.create({ url: target.helpUrl });
      return;
    }

    try {
      if (target.windowId != null) {
        await chrome.windows.update(target.windowId, { focused: true });
      }
      if (target.tabId != null) {
        await chrome.tabs.update(target.tabId, { active: true });
      }
    } catch {}

    if (typeof chrome.action?.openPopup === "function") {
      try {
        await chrome.action.openPopup();
      } catch {}
    }
  });
}

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

async function closeOffscreenIfIdle() {
  let hasActiveJob = pendingSuggestKeys.size > 0;
  if (!hasActiveJob && (await offscreenDocumentExists())) {
    try {
      const resp = await chrome.runtime.sendMessage({
        target: "offscreen",
        action: "has-active-streams",
      });
      hasActiveJob = !!resp?.active;
    } catch {}
  }
  if (hasActiveJob || popupConnected) {
    scheduleOffscreenIdleClose();
    return;
  }
  try {
    if (typeof chrome !== "undefined" && chrome.offscreen) {
      await chrome.offscreen.closeDocument();
    }
  } catch {}
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
    popupConnected = true;
    cancelOffscreenIdleClose();
    port.onDisconnect.addListener(() => {
      popupConnected = false;
      scheduleOffscreenIdleClose();
    });
    return;
  }

  if (!port.name.startsWith("popup-stream-")) return;
  const popupPort = port;

  const streamId = popupPort.name.replace("popup-stream-", "");

  if (isOffscreenStream(streamId)) {
    relayToOffscreenStream(popupPort, streamId);
    return;
  }

  const stream = activeStreams.get(streamId);

  if (!stream) {
    try {
      popupPort.postMessage({
        type: "error",
        error:
          "This response is no longer available (its stream expired). " +
          "Try summarizing again.",
      });
    } catch {}
    try {
      popupPort.disconnect();
    } catch {}
    return;
  }

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
    const level = String(message.level || "log").toUpperCase();
    const line = `[${timestamp}] [${level}] ${message.message}`;
    offscreenLogs.push(line);
    if (offscreenLogs.length > 50) {
      offscreenLogs.shift();
    }
    chrome.runtime
      .sendMessage({
        type: "live-offscreen-log",
        log: line,
      })
      .catch(() => {});
    return false;
  }

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

          const { customInstructions } = await getSettings();
          const resp = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: message.action,
            streamId,
            payload: { ...message.payload, customInstructions },
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
          if (isOffscreenStream(streamId)) {
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

        case "transformers-stream": {
          const streamId = nextStreamId("transformers");
          if (hasOffscreenAPI) {
            await ensureOffscreenDocument();
            const { action, ...jobPayload } = message.payload;
            const { customInstructions } = await getSettings();
            const resp = await chrome.runtime.sendMessage({
              target: "offscreen",
              action,
              streamId,
              payload: {
                ...jobPayload,
                provider: "transformers",
                customInstructions,
              },
            });
            if (resp?.error) throw new Error(resp.error);
          } else {
            startTransformersStream(streamId, message.payload);
          }
          sendResponse({ streamId });
          break;
        }

        case "transformers-status": {
          if (hasOffscreenAPI) {
            await ensureOffscreenDocument();
            const response = await chrome.runtime.sendMessage({
              target: "offscreen",
              action: "transformers-status",
            });
            sendResponse(response);
            break;
          }
          const { currentModelId, loadingModelId } = getTransformersStatus();
          sendResponse({
            ready: typeof WebAssembly !== "undefined",
            currentModel: currentModelId,
            loading: loadingModelId,
          });
          break;
        }

        case "extract-pdf": {
          const text = await extractPdfText(message.payload.pdfBase64);
          sendResponse({ text });
          break;
        }

        case "sponsorblock-segments": {
          const { useSponsorBlock } = await getSettings();
          const segments = useSponsorBlock
            ? await fetchSponsorBlockSegments(message.payload.videoId)
            : [];
          sendResponse({ segments });
          break;
        }

        case "bilibili-subtitles": {
          const segments = await fetchBilibiliSubtitles(message.payload || {});
          sendResponse({ segments });
          break;
        }

        case "suggest-questions-bg": {
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
