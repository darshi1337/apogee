import { summarizeText } from "../lib/summarize/ollamaSummarize.js";
import { resolveEffectiveLanguage } from "../lib/language/detectLanguage.js";
import {
  streamInTargetLanguage,
  generateInTargetLanguage,
} from "../lib/language/languageOutput.js";
import { makeOpusTranslateFn } from "../lib/language/opusTranslateEngine.js";
import { chatStream, checkHealth } from "../lib/engines/ollamaClient.js";
import {
  chatStream as llamaChatStream,
  checkHealth as llamaCheckHealth,
  DEFAULT_CONTEXT_TOKENS as LLAMACPP_DEFAULT_CONTEXT_TOKENS,
} from "../lib/engines/llamaCppClient.js";
import { getMaxChunkChars } from "../lib/engines/modelLimits.js";
import {
  tokensForChunk,
  isWarmedUp,
  tokensPerSecond,
  finalTokensPerSecond,
} from "../lib/util/throughput.js";
import { chunkBySections } from "../lib/summarize/sections.js";
import { errorHelpUrl } from "../lib/util/errorHelp.js";
import { toUserMessage, UserFacingError } from "../lib/util/userError.js";
import { hasHostPermissions } from "../lib/util/permissions.js";
import { ensureLoopbackCorsRule } from "../lib/util/loopbackCors.js";
import {
  buildAnswerPrompt,
  buildSuggestQuestionsPrompt,
  buildMultiTabSummaryPrompt,
  withCustomInstructions,
} from "../lib/summarize/prompts.js";
import { truncateForPrompt } from "../lib/summarize/chunk.js";
import { parseSuggestedQuestions } from "../lib/summarize/questions.js";
import { extractPdfText } from "../lib/extract/pdfExtract.js";
import {
  recordPageAccessEvent,
  getActivityAuditSummary,
} from "../lib/storage/activityAudit.js";
import {
  retrieveRelevantContent,
  findBestPassage,
} from "../lib/retrieval/rag.js";
import {
  withTransformersEngine,
  getTransformersStatus,
  transformersChatStream,
} from "../lib/engines/transformersEngine.js";
import { getSettings } from "../lib/storage/settings.js";
import { initDebugLogging, sanitizeLogMessage } from "../lib/util/log.js";
import { NotificationTargetManager } from "../lib/util/notificationTargets.js";
import {
  getSummaryCacheKey,
  getPromptsCacheKey,
  hashUrl,
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
  normalizeSelectedText,
  isSummarizableSelection,
  MIN_SELECTION_LENGTH,
} from "../lib/extract/selection.js";
import {
  getProviderType,
  getModelForSettings,
} from "../lib/engines/providers.js";
import { PROVIDERS, TRANSLATION_ENGINES } from "../lib/constants.js";
import { broadcastToStream } from "../lib/util/streamBroadcast.js";
import {
  saveViewState,
  saveViewStateIfJobMatches,
  removeViewState,
} from "../lib/storage/viewState.js";
import {
  COULD_NOT_READ_THIS_PAGE_ERROR_MSG,
  NOTHING_TO_SUMMARIZE_ERROR_MSG,
  COULD_NOT_EXTRACT_TEXT_FROM_PDF_ERROR_MSG,
} from "../lib/util/messages.js";

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

const registeredStreamJobs = new Map();

function registerStreamJob(streamId, jobData) {
  if (!streamId || !jobData?.finalize) return;
  registeredStreamJobs.set(streamId, jobData);
  scheduleStreamCleanup(streamId);
}

async function recordPopupSummaryStream(payload, streamId) {
  const finalize = payload?.finalize;
  if (!finalize?.jobId || finalize.tabId == null) return;
  registerStreamJob(streamId, {
    finalize,
    model: payload.model,
    title: payload.title,
    url: payload.url,
  });
  await saveViewStateIfJobMatches(
    finalize.tabId,
    finalize.jobId,
    {
      streamId,
      promptsCacheKey: finalize.promptsCacheKey,
      summaryLanguage: finalize.language,
      translationEngine: finalize.translationEngine,
    },
    "summarizing",
  );
}

async function buildTrustedFinalize(payload) {
  if (!payload || typeof payload !== "object") return null;

  const rawFinalize = payload.finalize || {};
  const customContent = rawFinalize.customContent === true;
  const rawUrl =
    typeof payload.url === "string"
      ? payload.url
      : typeof rawFinalize.persistUrl === "string"
        ? rawFinalize.persistUrl
        : "";
  if (!rawUrl && !customContent) return null;

  const settings = await getSettings();
  const model = payload.model || getModelForSettings(settings);
  const providerType = getProviderType(settings);
  const isSelection = Boolean(rawFinalize.isSelection);
  const cacheUrl = isSelection
    ? `${rawUrl}#apogee-selection`
    : rawUrl || `local:${await hashUrl(payload.content || "")}`;

  const cacheKey = await getSummaryCacheKey(
    cacheUrl,
    settings.responseFormat,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
  );
  const promptsCacheKey = await getPromptsCacheKey(
    cacheUrl,
    settings.responseFormat,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
  );

  const persist = isSelection ? false : await shouldPersist(rawUrl);

  const jobId =
    typeof rawFinalize.jobId === "string" && rawFinalize.jobId
      ? rawFinalize.jobId
      : `summary-${crypto.randomUUID()}`;

  const tabId =
    typeof rawFinalize.tabId === "number" ? rawFinalize.tabId : null;
  const windowId =
    typeof rawFinalize.windowId === "number" ? rawFinalize.windowId : null;
  const notifyOnFinish = Boolean(rawFinalize.notifyOnFinish);
  const sensitive = await isPrivateUrl(rawUrl, settings);

  return {
    cacheKey,
    promptsCacheKey,
    persist,
    persistUrl: rawUrl,
    isSelection,
    customContent,
    providerType,
    host: settings.ollamaHost,
    notifyOnFinish,
    sensitive,
    tabId,
    jobId,
    windowId,
    language: settings.summaryLanguage,
    translationEngine: settings.translationEngine,
  };
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

const ALLOWED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

// The rejected value stays in the console line only. The user-facing message states the rule instead, so a mistyped host reads as guidance rather than an internal assertion. ERROR.md documents this message word for word.
function rejectLoopbackHost(label, host, reason) {
  console.error(`${label} host rejected (${reason}): ${host}`);
  const allowed = [...ALLOWED_LOOPBACK_HOSTS].join(" or ");
  return new UserFacingError(
    `Apogee can only reach ${label} over http on ${allowed}. Check the host in Settings.`,
  );
}

function validateLoopbackHost(host, label = "Ollama") {
  let url;
  try {
    url = new URL(host);
  } catch {
    throw rejectLoopbackHost(label, host, "unparseable URL");
  }
  if (url.protocol !== "http:") {
    throw rejectLoopbackHost(label, host, `protocol ${url.protocol}`);
  }
  if (!ALLOWED_LOOPBACK_HOSTS.has(url.hostname)) {
    throw rejectLoopbackHost(label, host, `hostname ${url.hostname}`);
  }
  return url.toString().replace(/\/+$/, "");
}

// What a loopback HTTP provider contributes to a generation job: the client that talks to it, the name its errors are written in, and the message action its stream arrives on. Everything else in the two functions below is the same whichever server is answering. Ollama is the default, so its call sites pass nothing and behave exactly as before.
const OLLAMA_PROVIDER = {
  label: "Ollama",
  streamKind: "ollama-stream",
  chatStream,
};

// llama-server reports the context window it is actually running, which comes from its own -c launch flag and so cannot be read off the model name. Ollama has no equivalent, which is why only this provider supplies the hook.
const LLAMACPP_PROVIDER = {
  label: "llama.cpp",
  streamKind: "llamacpp-stream",
  chatStream: llamaChatStream,
  async getContextTokens(host, apiKey) {
    const health = await llamaCheckHealth(host, 3000, apiKey);
    return health.contextTokens ?? LLAMACPP_DEFAULT_CONTEXT_TOKENS;
  },
};
async function getRelevantAskContent(content, question) {
  if (!hasOffscreenAPI) {
    try {
      return await retrieveRelevantContent({ content, question });
    } catch (err) {
      console.error(
        "Relevant-content retrieval in background failed, falling back to truncation:",
        err,
      );
      return truncateForPrompt(content);
    }
  }
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
    errorUserFacing: false,
    cancelled: false,
    subscribers: new Set(),
    controller: new AbortController(),
    tokenCount: 0,
    firstTokenTime: null,
    tokensPerSec: null,
  };
  activeStreams.set(streamId, stream);
  startKeepAlive();

  const finish = (msg) => {
    if (stream.cancelled) return;
    if (msg.type === "done") {
      stream.done = true;
      const elapsedMs =
        stream.firstTokenTime != null
          ? performance.now() - stream.firstTokenTime
          : 0;
      stream.tokensPerSec =
        finalTokensPerSecond({
          serverStats: msg.serverStats ?? null,
          tokenCount: stream.tokenCount,
          elapsedMs,
        }) || null;
      msg = { ...msg, tokensPerSec: stream.tokensPerSec };
    }
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.errorUserFacing = !!msg.userFacing;
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
    if (stream.firstTokenTime == null)
      stream.firstTokenTime = performance.now();
    stream.tokenCount += tokensForChunk(text);
    broadcastToStream(stream, { type: "chunk", text });
    const elapsedMs = performance.now() - stream.firstTokenTime;
    if (isWarmedUp(stream.tokenCount, elapsedMs)) {
      broadcastToStream(stream, {
        type: "stats",
        tokensPerSec: tokensPerSecond(stream.tokenCount, elapsedMs),
      });
    }
  };

  return { stream, finish, emitChunk };
}

async function startLocalHttpStream(
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
    isSelection,
    apiKey,
  },
  client = OLLAMA_PROVIDER,
) {
  const { stream, finish, emitChunk } = createBufferedStream(streamId, {
    finalize,
    model,
    title,
    url,
  });

  let validHost;
  try {
    validHost = validateLoopbackHost(host, client.label);
  } catch (err) {
    finish({
      type: "error",
      error: err.message,
      userFacing: !!err?.isUserFacing,
    });
    return;
  }

  const { customInstructions } = await getSettings();

  // Populated once the final chunk carries the backend's own token count and duration (Ollama's eval_count/eval_duration, llama.cpp's timings). It is more accurate than our own count since it excludes network transit.
  let serverStats = null;

  // Ollama's client ignores the extra option; llama.cpp's uses it when the server was started with --api-key.
  const chatStreamFn = (h, m, p, opts) =>
    client.chatStream(h, m, p, {
      ...opts,
      apiKey,
      onFinalStats: (s) => {
        serverStats = s;
      },
    });

  // Only a provider that can report its own window gets an explicit chunk size; everyone else keeps the model-name inference in getMaxChunkChars.
  let chunkTextFn;
  if (client.getContextTokens) {
    try {
      const contextTokens = await client.getContextTokens(validHost, apiKey);
      const chunkChars = getMaxChunkChars(model, contextTokens);
      chunkTextFn = (text) => chunkBySections(text, chunkChars);
    } catch (err) {
      // A window we could not read is not worth failing the job over: fall through to the name-based estimate the other providers use.
      console.error("llama.cpp context-window lookup failed:", err);
    }
  }

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
          isSelection,
          host: validHost,
          signal: stream.controller.signal,
        },
        {
          chatStreamFn,
          ...(chunkTextFn ? { chunkTextFn } : {}),
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
      const chat = (p, opts) => chatStreamFn(validHost, model, p, opts);
      generator = streamInTargetLanguage(
        chat,
        prompt,
        await resolveEffectiveLanguage(content, language),
        { signal: stream.controller.signal, translateFn },
      );
    } else {
      throw new Error(`Unknown ${client.streamKind} action: ${action}`);
    }

    for await (const token of generator) {
      emitChunk(token);
    }
    finish({ type: "done", serverStats });
  } catch (err) {
    finish({
      type: "error",
      error: err.message,
      userFacing: !!err?.isUserFacing,
    });
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
    isSelection,
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
            isSelection,
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
    finish({
      type: "error",
      error: err?.message || String(err),
      userFacing: !!err?.isUserFacing,
    });
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

  const selection = normalizeSelectedText(selectionText);
  if (selection && !isSummarizableSelection(selection)) {
    if (notifyOnFinish) {
      notifyNothingToSummarize(
        `Select at least ${MIN_SELECTION_LENGTH} characters to summarize.`,
      );
    }
    return;
  }
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
        notifyNothingToSummarize(COULD_NOT_READ_THIS_PAGE_ERROR_MSG);
      }
      return;
    }
    if (!pageData.isPdf && !pageData.content) {
      if (notifyOnFinish) {
        notifyNothingToSummarize(NOTHING_TO_SUMMARIZE_ERROR_MSG);
      }
      return;
    }
  }

  const persist = isSelection ? false : await shouldPersist(tab.url);
  const cacheUrl = isSelection ? `${tab.url}#apogee-selection` : tab.url;

  if (!isSelection && CACHEABLE_PAGE_TYPES.has(pageData.type) && persist) {
    await persistContent(tab.url, pageData);
  }

  recordPageAccessEvent({
    title: pageData.title,
    url: pageData.url,
    contentLength: (pageData.content || "").length,
    type: pageData.type,
  }).catch(() => {});

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
        notifyNothingToSummarize(COULD_NOT_EXTRACT_TEXT_FROM_PDF_ERROR_MSG);
      }
      return;
    }
  }

  const jobId = `summary-${crypto.randomUUID()}`;
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
    jobId,
    windowId: tab.windowId,
    ...(isSelection ? { selectionText: selection } : {}),
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
    isSelection,
    finalize,
  };

  let streamId;
  if (providerType === PROVIDERS.LOCAL) {
    streamId = nextStreamId("ollama");
  } else if (providerType === PROVIDERS.LLAMACPP) {
    streamId = nextStreamId("llamacpp");
  } else if (providerType === PROVIDERS.TRANSFORMERS) {
    streamId = nextStreamId("transformers");
  } else {
    await ensureOffscreenDocument();
    streamId = nextStreamId("webllm");
  }

  registerStreamJob(streamId, {
    finalize,
    model,
    title: pageData.title,
    url: pageData.url,
  });

  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "summarizing",
    url: tab.url,
    streamId,
    jobId,
    summaryText: "",
    timeSaved: null,
    promptsCacheKey: finalize.promptsCacheKey,
    summaryLanguage: settings.summaryLanguage,
    translationEngine: settings.translationEngine,
    ...(isSelection ? { isSelection: true, selectionText: selection } : {}),
  });

  if (providerType === PROVIDERS.LOCAL) {
    startLocalHttpStream(streamId, { ...common, host: settings.ollamaHost });
  } else if (providerType === PROVIDERS.LLAMACPP) {
    startLocalHttpStream(
      streamId,
      {
        ...common,
        host: settings.llamaHost,
        apiKey: settings.llamaApiKey,
      },
      LLAMACPP_PROVIDER,
    );
  } else if (providerType === PROVIDERS.TRANSFORMERS) {
    startTransformersStream(streamId, common);
  } else {
    const resp = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "summarize",
      streamId,
      payload: common,
    });
    if (resp?.error) throw new Error(resp.error);
  }
}

function notifyJobFailed(err) {
  console.error("Background summarize failed:", err);
  if (typeof chrome.notifications === "undefined") return;
  const message = toUserMessage(err);
  const notificationId = `apogee-summary-error-${crypto.randomUUID()}`;
  // A notification body cannot hold a link, so clicking it opens the explanation instead of focusing the tab.
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

if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled?.addListener) {
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
}

// Narrow the bundled loopback Origin-strip to this extension's non-tab requests where session rules are supported; loopback clients await the same helper before fetching, so this is only a fast track. Never rejects.
ensureLoopbackCorsRule().catch(() => {});

if (
  typeof chrome !== "undefined" &&
  chrome.contextMenus?.onClicked?.addListener
) {
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
}

if (typeof chrome !== "undefined" && chrome.commands?.onCommand?.addListener) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "summarize-page") return;
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;
    runBackgroundSummarize(tab, { notifyOnFinish: true }).catch((err) =>
      notifyJobFailed(err),
    );
  });
}

if (typeof chrome !== "undefined" && chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    removeViewState(tabId).catch(() => {});
  });
}

const SPONSORBLOCK_CATEGORIES = ["sponsor", "selfpromo", "interaction"];

export async function fetchSponsorBlockSegments(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) return [];

  // "Stay fully local" means no SponsorBlock lookup at all; the uploader falls back to its local phrase heuristic.
  const { useSponsorBlock } = await getSettings();
  if (useSponsorBlock === false || useSponsorBlock === "off") return [];

  const hasPerm = await hasHostPermissions([
    "*://*.youtube.com/*",
    "https://sponsor.ajay.app/*",
  ]);
  if (!hasPerm) return [];

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
  const hasPerm = await hasHostPermissions([
    "*://*.bilibili.com/*",
    "*://*.hdslb.com/*",
  ]);
  if (!hasPerm) return [];

  let listRes;
  try {
    // Note: credentials: "include" is required for Bilibili's /x/player/v2 endpoint because Bilibili restricts subtitle list metadata to logged-in sessions. Cookies are strictly scoped to api.bilibili.com API requests on Bilibili pages.
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
    // Subtitle track content on the hdslb.com CDN does not require session authentication, so credentials are explicitly omitted to restrict cookie scope.
    subRes = await fetch(subUrl, {
      credentials: "omit",
      signal: AbortSignal.timeout(6000),
    });
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

async function generateLocalSuggestions(
  host,
  model,
  { title, url, summary, language, translationEngine },
  client = OLLAMA_PROVIDER,
  apiKey = "",
) {
  const validHost = validateLoopbackHost(host, client.label);
  const prompt = buildSuggestQuestionsPrompt(title, url, summary);
  const chat = (p, opts) =>
    client.chatStream(validHost, model, p, { ...opts, apiKey });
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
      if (providerType === PROVIDERS.LLAMACPP) {
        const { llamaHost, llamaApiKey } = await getSettings();
        questions = await generateLocalSuggestions(
          llamaHost,
          model,
          { title, url, summary, language },
          LLAMACPP_PROVIDER,
          llamaApiKey,
        );
      } else if (providerType === PROVIDERS.LOCAL) {
        questions = await generateLocalSuggestions(host, model, {
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

    // Generating the questions takes its own trip through the model, so the setting gets one more look before this write too.
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
    jobId,
    windowId,
    language,
    translationEngine,
  } = finalize;

  // `persist` is what was true when the job started. The write only happens if it is still true now, so turning history off mid-generation also excludes the summary that is running.
  const persisted =
    persist &&
    (await persistSummaryIfAllowed(
      persistUrl || url,
      cacheKey,
      promptsCacheKey,
      text,
      title,
    ));

  if (persisted || isSelection) {
    await saveViewStateIfJobMatches(
      tabId,
      jobId,
      {
        view: "summaryView",
        subview: "summary",
        url: persistUrl || url,
        streamId: null,
        summaryText: text,
        promptsCacheKey,
        summaryLanguage: language,
        translationEngine,
      },
      "summarizing",
    );
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

const notificationTargets = new NotificationTargetManager();

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

  if (typeof chrome.notifications.onClosed !== "undefined") {
    chrome.notifications.onClosed.addListener((notificationId) => {
      notificationTargets.delete(notificationId);
    });
  }
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

if (typeof chrome !== "undefined" && chrome.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === OFFSCREEN_IDLE_ALARM) {
      closeOffscreenIfIdle();
      return;
    }
    if (alarm.name.startsWith(STREAM_CLEANUP_PREFIX)) {
      const streamId = alarm.name.slice(STREAM_CLEANUP_PREFIX.length);
      activeStreams.delete(streamId);
      registeredStreamJobs.delete(streamId);
    }
  });
}

const activeSidePanelTabs = new Set();

if (typeof chrome !== "undefined" && chrome.runtime?.onConnect?.addListener) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name && port.name.startsWith("side-panel-tab-")) {
      const tabId = parseInt(port.name.replace("side-panel-tab-", ""), 10);
      if (!isNaN(tabId)) {
        activeSidePanelTabs.add(tabId);
        port.onDisconnect.addListener(() => {
          activeSidePanelTabs.delete(tabId);
        });
      }
      return;
    }

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
        popupPort.postMessage({
          type: "error",
          error: stream.error,
          userFacing: stream.errorUserFacing,
        });
      } catch {}
    } else if (stream.done) {
      try {
        popupPort.postMessage({
          type: "done",
          tokensPerSec: stream.tokensPerSec,
        });
      } catch {}
    } else if (stream.firstTokenTime != null) {
      const elapsedMs = performance.now() - stream.firstTokenTime;
      if (isWarmedUp(stream.tokenCount, elapsedMs)) {
        try {
          popupPort.postMessage({
            type: "stats",
            tokensPerSec: tokensPerSecond(stream.tokenCount, elapsedMs),
          });
        } catch {}
      }
    }

    popupPort.onDisconnect.addListener(() => {
      stream.subscribers.delete(popupPort);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "service-worker") return false;

  if (sender.id !== chrome.runtime.id) return false;

  const ALLOWED_CONTENT_SCRIPT_ACTIONS = new Set([
    "sponsorblock-segments",
    "bilibili-subtitles",
    "summarize-selection",
  ]);
  if (
    sender.tab &&
    (!message.action || !ALLOWED_CONTENT_SCRIPT_ACTIONS.has(message.action))
  ) {
    return false;
  }

  if (message.type === "offscreen-ready") {
    _offscreenScriptReadyResolve();
    return false;
  }

  if (message.type === "check-side-panel-open") {
    sendResponse({ isOpen: activeSidePanelTabs.has(message.tabId) });
    return true;
  }

  if (message.type === "check-host-permissions") {
    hasHostPermissions(message.origins || []).then((hasPermissions) => {
      sendResponse({ hasPermissions });
    });
    return true;
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

  if (message.action === "summarize-selection" && sender.tab) {
    runBackgroundSummarize(sender.tab, {
      notifyOnFinish: true,
      selectionText: message.payload?.selectionText,
    })
      .then(() =>
        chrome.runtime
          .sendMessage({ type: "selection-summary-started" })
          .catch(() => {}),
      )
      .catch((err) => notifyJobFailed(err));
    return false;
  }

  if (message.type === "offscreen-log") {
    const timestamp = new Date().toLocaleTimeString();
    const level = String(message.level || "log").toUpperCase();
    const sanitized = sanitizeLogMessage(message.message);
    const line = `[${timestamp}] [${level}] ${sanitized}`;
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
    (async () => {
      const streamId = message.streamId;
      const registeredJob = streamId
        ? registeredStreamJobs.get(streamId)
        : null;
      if (streamId) {
        registeredStreamJobs.delete(streamId);
      }

      const trustedFinalize =
        registeredJob?.finalize ||
        (message.finalize
          ? await buildTrustedFinalize({
              url: message.url,
              title: message.title,
              model: message.model,
              finalize: message.finalize,
            })
          : null);
      const model = registeredJob?.model || message.model;
      const title = registeredJob?.title || message.title;
      const url = registeredJob?.url || message.url;

      await finalizeSummaryJob({
        finalize: trustedFinalize,
        model,
        title,
        url,
        text: message.text,
      });
    })();
    return false;
  }

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          await ensureOffscreenDocument();

          const streamId = nextStreamId("webllm");
          const trustedFinalize =
            message.action === "summarize"
              ? await buildTrustedFinalize(message.payload)
              : null;
          const payload = {
            ...message.payload,
            ...(trustedFinalize ? { finalize: trustedFinalize } : {}),
          };
          await recordPopupSummaryStream(payload, streamId);

          const { customInstructions } = await getSettings();
          const resp = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: message.action,
            streamId,
            payload: { ...payload, customInstructions },
          });
          if (resp?.error) throw new Error(resp.error);

          sendResponse({ streamId });
          break;
        }

        case "ollama-stream": {
          const streamId = nextStreamId("ollama");
          const settings = await getSettings();
          const trustedFinalize =
            message.payload?.action === "summarize" || message.payload?.finalize
              ? await buildTrustedFinalize(message.payload)
              : null;
          const payload = {
            ...message.payload,
            ...(trustedFinalize ? { finalize: trustedFinalize } : {}),
            host: settings.ollamaHost,
          };
          await recordPopupSummaryStream(payload, streamId);
          startLocalHttpStream(streamId, payload);
          sendResponse({ streamId });
          break;
        }

        case "llamacpp-stream": {
          const streamId = nextStreamId("llamacpp");
          const settings = await getSettings();
          const trustedFinalize =
            message.payload?.action === "summarize" || message.payload?.finalize
              ? await buildTrustedFinalize(message.payload)
              : null;
          const payload = {
            ...message.payload,
            ...(trustedFinalize ? { finalize: trustedFinalize } : {}),
            host: settings.llamaHost,
            apiKey: settings.llamaApiKey,
          };
          await recordPopupSummaryStream(payload, streamId);
          startLocalHttpStream(streamId, payload, LLAMACPP_PROVIDER);
          sendResponse({ streamId });
          break;
        }

        case "llamacpp-status": {
          const { llamaHost, llamaApiKey } = await getSettings();
          let validHost;
          try {
            validHost = validateLoopbackHost(
              llamaHost,
              LLAMACPP_PROVIDER.label,
            );
          } catch {
            sendResponse({
              connected: false,
              models: [],
              contextTokens: null,
            });
            break;
          }
          const response = await llamaCheckHealth(validHost, 3000, llamaApiKey);
          sendResponse(response);
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
            validHost = validateLoopbackHost(message.payload.host);
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
          const settings = await getSettings();
          const trustedFinalize =
            message.payload?.action === "summarize" || message.payload?.finalize
              ? await buildTrustedFinalize(message.payload)
              : null;
          const payload = {
            ...message.payload,
            ...(trustedFinalize ? { finalize: trustedFinalize } : {}),
          };
          await recordPopupSummaryStream(payload, streamId);
          if (hasOffscreenAPI) {
            await ensureOffscreenDocument();
            const { action, ...jobPayload } = payload;
            const resp = await chrome.runtime.sendMessage({
              target: "offscreen",
              action,
              streamId,
              payload: {
                ...jobPayload,
                provider: "transformers",
                customInstructions: settings.customInstructions,
              },
            });
            if (resp?.error) throw new Error(resp.error);
          } else {
            startTransformersStream(streamId, payload);
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
          const pdfBase64 = message.payload?.pdfBase64;
          const MAX_PDF_BASE64_LENGTH = Math.ceil((50 * 1024 * 1024 * 4) / 3);
          if (
            typeof pdfBase64 !== "string" ||
            pdfBase64.length > MAX_PDF_BASE64_LENGTH
          ) {
            throw new Error(
              "PDF input missing or exceeds maximum allowed size.",
            );
          }
          const text = await extractPdfText(pdfBase64);
          sendResponse({ text });
          break;
        }

        case "sponsorblock-segments": {
          const segments = message.payload?.videoId
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
          const settings = await getSettings();
          const rawUrl =
            typeof message.payload?.url === "string" ? message.payload.url : "";
          const model = message.payload?.model || getModelForSettings(settings);
          const promptsCacheKey = rawUrl
            ? await getPromptsCacheKey(
                rawUrl,
                settings.responseFormat,
                model,
                settings.summaryLanguage,
                settings.customInstructions,
                settings.translationEngine,
              )
            : message.payload?.promptsCacheKey;
          runSuggestQuestionsJob({
            ...message.payload,
            ...(promptsCacheKey ? { promptsCacheKey } : {}),
            providerType: getProviderType(settings),
            host: settings.ollamaHost,
          });
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
            try {
              const { content, query } = message.payload || {};
              const passage = await findBestPassage({ content, query });
              sendResponse({ passage });
            } catch (err) {
              sendResponse({ error: err.message });
            }
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

        case "retrieve-context": {
          if (!hasOffscreenAPI) {
            try {
              const { content, question } = message.payload || {};
              const relevantContent = await retrieveRelevantContent({
                content,
                question,
              });
              sendResponse({ content: relevantContent });
            } catch (err) {
              sendResponse({ error: err.message });
            }
            break;
          }
          await ensureOffscreenDocument();
          const response = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "retrieve-context",
            payload: message.payload,
          });
          sendResponse(response);
          break;
        }

        case "get-activity-audit": {
          const auditSummary = await getActivityAuditSummary();
          sendResponse(auditSummary);
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

        case "summarize-multi-tab": {
          let targetTabs = [];
          if (typeof chrome.tabs?.query === "function") {
            targetTabs = await chrome.tabs.query({
              highlighted: true,
              currentWindow: true,
            });
          }
          const res = await summarizeMultiTab(targetTabs || []);
          sendResponse(res || { error: "Could not summarize selected tabs." });
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

export function setupContextMenus() {
  if (typeof chrome === "undefined" || !chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "apogee-summarize-tabs",
      title: "Summarize with Apogee",
      contexts: ["page", "selection", "tab", "action"],
    });
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    setupContextMenus();
  });
}
setupContextMenus();

export async function summarizeMultiTab(tabsToSummarize) {
  const extractedResults = [];
  for (const tab of tabsToSummarize) {
    try {
      if (!tab?.url) continue;
      let pageData = await extractFromActiveTab(tab);
      if (pageData?.isPdf) {
        pageData.content = await extractPdfContent(tab);
      }
      if (pageData && pageData.content && pageData.content.trim()) {
        extractedResults.push({
          title: pageData.title || tab.title || "Untitled Tab",
          url: tab.url,
          content: pageData.content.trim(),
          type: pageData.type || "article",
        });
      }
    } catch {
      // Gracefully ignore unscriptable tabs
    }
  }

  if (extractedResults.length === 0) {
    if (typeof chrome !== "undefined" && chrome.notifications) {
      chrome.notifications.create("apogee-multitab-error", {
        type: "basic",
        iconUrl:
          chrome.runtime.getURL("assets/icon.png") || "assets/icon-48.png",
        title: "Apogee",
        message: "Could not extract content from the selected tab(s).",
      });
    }
    return null;
  }

  const notificationId = `apogee-multitab-${Date.now()}`;
  if (typeof chrome !== "undefined" && chrome.notifications) {
    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon.png") || "assets/icon-48.png",
      title: "Apogee Multi-Tab Summary",
      message: `Extracting and summarizing ${extractedResults.length} selected tab(s)...`,
    });
  }

  const settings = await getSettings();
  const title = `Multi-Tab Summary (${extractedResults.length} tabs)`;
  const url = tabsToSummarize[0]?.url || extractedResults[0].url;

  const prompt = withCustomInstructions(
    buildMultiTabSummaryPrompt(extractedResults, settings.responseFormat),
    settings.customInstructions,
  );

  const providerType = getProviderType(settings);
  const model = getModelForSettings(settings);
  const qLanguage = await resolveEffectiveLanguage(
    extractedResults.map((r) => r.content).join("\n"),
    settings.summaryLanguage,
  );
  const translateFn =
    settings.translationEngine === TRANSLATION_ENGINES.OPUS
      ? makeOpusTranslateFn(() => {})
      : undefined;

  let summaryResult;
  if (providerType === PROVIDERS.LOCAL) {
    const validHost = validateLoopbackHost(
      settings.ollamaHost,
      OLLAMA_PROVIDER.label,
    );
    const chat = (p, opts) => chatStream(validHost, model, p, opts);
    summaryResult = await generateInTargetLanguage(chat, prompt, qLanguage, {
      translateFn,
    });
  } else if (providerType === PROVIDERS.LLAMACPP) {
    const validHost = validateLoopbackHost(
      settings.llamaHost,
      LLAMACPP_PROVIDER.label,
    );
    const chat = (p, opts) =>
      llamaChatStream(validHost, model, p, {
        ...opts,
        apiKey: settings.llamaApiKey,
      });
    summaryResult = await generateInTargetLanguage(chat, prompt, qLanguage, {
      translateFn,
    });
  } else if (providerType === PROVIDERS.TRANSFORMERS && !hasOffscreenAPI) {
    summaryResult = await withTransformersEngine(model, null, async (eng) => {
      const chat = (p, opts) =>
        transformersChatStream(eng, p, { system: opts?.system });
      return generateInTargetLanguage(chat, prompt, qLanguage, { translateFn });
    });
  } else {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "generate-text",
      payload: {
        prompt,
        model,
        provider:
          providerType === PROVIDERS.TRANSFORMERS ? "transformers" : "webllm",
        language: settings.summaryLanguage,
        translationEngine: settings.translationEngine,
      },
    });
    if (response?.error) throw new Error(response.error);
    summaryResult = response?.text || "";
  }

  const pageData = {
    type: "multi-tab",
    title,
    url,
    content: summaryResult,
    tabs: extractedResults.map((t) => ({ title: t.title, url: t.url })),
  };

  await saveViewState(url, {
    status: "completed",
    summary: summaryResult,
    pageData,
  });

  if (typeof chrome !== "undefined" && chrome.notifications) {
    chrome.notifications.create(`${notificationId}-ready`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon.png") || "assets/icon-48.png",
      title: "Apogee Multi-Tab Summary Ready",
      message: `Synthesized summary for ${extractedResults.length} tabs. Click to view in Apogee!`,
    });
  }

  return { summary: summaryResult, pageData };
}

if (typeof chrome !== "undefined" && chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "apogee-summarize-tabs") {
      let targetTabs = [tab];
      if (typeof chrome.tabs?.query === "function") {
        const highlighted = await chrome.tabs.query({
          highlighted: true,
          currentWindow: true,
        });
        if (highlighted && highlighted.length > 0) {
          targetTabs = highlighted;
        }
      }
      await summarizeMultiTab(targetTabs);
    }
  });
}

if (typeof chrome !== "undefined" && chrome.notifications) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith("apogee-multitab")) {
      if (typeof chrome.action?.openPopup === "function") {
        chrome.action.openPopup().catch(() => {});
      }
    }
  });
}
