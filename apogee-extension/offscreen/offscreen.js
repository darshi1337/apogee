import { parseSuggestedQuestions } from "../lib/summarize/questions.js";
import { summarizeText } from "../lib/summarize/ollamaSummarize.js";
import { resolveEffectiveLanguage } from "../lib/language/detectLanguage.js";
import {
  streamInTargetLanguage,
  generateInTargetLanguage,
} from "../lib/language/languageOutput.js";
import { opusTranslateFnFor } from "../lib/language/opusTranslateEngine.js";
import {
  retrieveRelevantContent,
  findBestPassage,
  selectSalientChunks,
} from "../lib/retrieval/rag.js";
import { createLock } from "../lib/util/mutex.js";
import { toUserMessage } from "../lib/util/userError.js";
import { WEBLLM_MODELS, isKnownWebLLMModelId } from "../lib/constants.js";
import {
  OFFSCREEN_STALL_NOTE_MS,
  WEBLLM_DOWNLOAD_RETRY_BASE_DELAY_MS,
} from "../lib/constants.js";
import { retryWithBackoff, retryProgressText } from "../lib/util/retry.js";
import {
  withTransformersEngine,
  transformersChatStream,
  getTransformersStatus,
} from "../lib/engines/transformersEngine.js";
import { initDebugLogging } from "../lib/util/log.js";
import {
  broadcastToStream,
  disconnectStreamPorts,
  safeDisconnect,
  safePost,
} from "../lib/util/streamBroadcast.js";
import {
  createStreamState,
  emitChunkToState,
  finishStateWithStats,
  replayStreamToPort,
} from "../lib/util/streamState.js";
import {
  createSlidingExpiry,
  STREAM_CLEANUP_MS,
} from "../lib/util/streamExpiry.js";
import { createSummarizeProgressTracker } from "../lib/summarize/progress.js";

initDebugLogging();

const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

function sendLogToServiceWorker(level, args) {
  const message = args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");

  chrome.runtime
    .sendMessage({
      target: "service-worker",
      type: "offscreen-log",
      level,
      message,
    })
    .catch(() => {});
}

console.log = (...args) => {
  originalConsole.log(...args);
  sendLogToServiceWorker("log", args);
};
console.error = (...args) => {
  originalConsole.error(...args);
  sendLogToServiceWorker("error", args);
};
console.warn = (...args) => {
  originalConsole.warn(...args);
  sendLogToServiceWorker("warn", args);
};
console.info = (...args) => {
  originalConsole.info(...args);
  sendLogToServiceWorker("info", args);
};

window.addEventListener("error", (event) => {
  console.error(
    "Global error in offscreen document:",
    event.message,
    "at",
    event.filename,
    ":",
    event.lineno,
  );
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(
    "Unhandled promise rejection in offscreen document:",
    event.reason?.stack || event.reason?.message || event.reason,
  );
});

let engine = null;
let currentModelId = null;
let loadingModelId = null;

const acquireLock = createLock();

// Bound the wait for the WebLLM engine so one stalled model download does
// not head-of-line-block every later stream forever. First-time downloads
// are multi-GB and take many minutes, so the bound is generous (20 min).
// Downloads resume from cache, so failing fast with a clear message beats
// hanging.
const ENGINE_LOCK_TIMEOUT_MS = 20 * 60 * 1000;

function isCorruptingEngineError(err) {
  return /out of memory|\boom\b|buffer allocation|gpubuffer|allocation failed|memory limit|disposed|destroyed|context (was )?lost/i.test(
    err?.message || "",
  );
}

let engineOwnerStreamId = null;

let _webllm = null;
let _prompts = null;

async function getWebLLM() {
  if (!_webllm) {
    _webllm = await import("@mlc-ai/web-llm");
  }
  return _webllm;
}

async function getPrompts() {
  if (!_prompts) {
    _prompts = await import("../lib/summarize/prompts.js");
  }
  return _prompts;
}

async function ensureEngine(modelId) {
  // Defense in depth behind the settings sanitize: the offscreen document
  // also accepts model ids from message payloads, so reject anything outside
  // the allow-list here, where a miss would otherwise fall back to a remote
  // HuggingFace CDN fetch for model config.
  if (!isKnownWebLLMModelId(modelId)) {
    throw new Error(
      `Unknown WebLLM model "${modelId}". Pick one of the bundled models in settings.`,
    );
  }
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine) {
    try {
      await engine.unload();
    } catch {
      // intent: best-effort, ignore if already closed/unavailable
    }
    engine = null;
    currentModelId = null;
  }

  loadingModelId = modelId;

  const { CreateMLCEngine, prebuiltAppConfig } = await getWebLLM();

  const bundledModelLibs = new Map(
    WEBLLM_MODELS.filter((m) => m.lib).map((m) => [
      m.id,
      chrome.runtime.getURL(`assets/model-libs/${m.lib}`),
    ]),
  );

  const sendProgress = (progress) => {
    chrome.runtime
      .sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress,
        modelId,
        kind: "download",
      })
      .catch(() => {});
  };

  const STALL_NOTE_MS = OFFSCREEN_STALL_NOTE_MS;
  let lastReport = null;
  let stallTimer = null;
  const scheduleStallNote = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (lastReport) {
        sendProgress({
          ...lastReport,
          text:
            `${lastReport.text} - still downloading, the model host is ` +
            "responding slowly. Progress is saved as it goes.",
        });
      }
      scheduleStallNote();
    }, STALL_NOTE_MS);
  };

  const engineOptions = {
    initProgressCallback: (report) => {
      lastReport = report;
      scheduleStallNote();
      sendProgress(report);
    },
    appConfig: {
      ...prebuiltAppConfig,
      cacheBackend: "cache",
      model_list: prebuiltAppConfig.model_list.map((m) =>
        bundledModelLibs.has(m.model_id)
          ? { ...m, model_lib: bundledModelLibs.get(m.model_id) }
          : m,
      ),
    },
  };

  const MAX_DOWNLOAD_ATTEMPTS = 4;
  try {
    scheduleStallNote();
    try {
      engine = await retryWithBackoff({
        maxAttempts: MAX_DOWNLOAD_ATTEMPTS,
        baseDelayMs: WEBLLM_DOWNLOAD_RETRY_BASE_DELAY_MS,
        isTransient: isInterruptedDownloadError,
        onRetry: (attempt, err) => {
          console.error(`Model load attempt ${attempt} failed:`, err);
          sendProgress({
            progress: 0,
            text: retryProgressText(attempt, MAX_DOWNLOAD_ATTEMPTS),
          });
        },
        task: () => CreateMLCEngine(modelId, engineOptions),
      });
    } catch (err) {
      console.error("Model load failed:", err);
      loadingModelId = null;
      if (!isInterruptedDownloadError(err)) throw err;
      throw new Error(
        "The model download keeps getting interrupted (the download " +
          "server stalled or the connection dropped). Progress so far " +
          "is saved, so trying again later will resume where it left " +
          "off.",
        { cause: err },
      );
    }
  } finally {
    clearTimeout(stallTimer);
  }

  currentModelId = modelId;
  loadingModelId = null;
  return engine;
}

function isInterruptedDownloadError(err) {
  return /cache\.add|network\s?error|failed to fetch/i.test(err?.message || "");
}

function resetEngineState() {
  engine = null;
  currentModelId = null;
  loadingModelId = null;
}

async function withEngine(modelId, fn, ownerStreamId = null, options = {}) {
  // Allow (modelId, fn, { signal, lockTimeout }) as well as the legacy
  // (modelId, fn, streamId) shape.
  let owner = ownerStreamId;
  let opts = options;
  if (ownerStreamId && typeof ownerStreamId === "object") {
    opts = ownerStreamId;
    owner = opts.ownerStreamId ?? null;
  }
  const release = await acquireLock({
    timeout: opts.lockTimeout ?? ENGINE_LOCK_TIMEOUT_MS,
    signal: opts.signal,
  });
  engineOwnerStreamId = owner;
  try {
    // Load failures already cleared loading state; a lock timeout/abort
    // throws above before we hold anything, so never discard here.
    const eng = await ensureEngine(modelId);
    try {
      return await fn(eng);
    } catch (err) {
      // A transient generation failure must not discard a healthy multi-GB
      // engine. Only drop it when the error shows the engine itself is
      // corrupted (OOM); otherwise the next stream would pay a full reload.
      if (isCorruptingEngineError(err)) {
        resetEngineState();
      }
      throw err;
    }
  } finally {
    engineOwnerStreamId = null;
    release();
  }
}

// WebLLM's engine can report its own decode rate on the final chunk's `usage` field when the request asks for it (`stream_options.include_usage`). That is more accurate than our own count, since it comes straight from the engine rather than from chunk-arrival timing. Unverified against a live build at time of writing: if the installed @mlc-ai/web-llm version does not populate `usage.extra.decode_tokens_per_s`, this silently never fires and the computed rate is used instead, which is already the designed fallback.
function reportWebLLMFinalStats(chunk, onFinalStats) {
  const tokens = chunk?.usage?.completion_tokens;
  const rate = chunk?.usage?.extra?.decode_tokens_per_s;
  if (tokens > 0 && rate > 0) {
    onFinalStats?.({ tokens, durationMs: (tokens / rate) * 1000 });
  }
}

async function* drainWebLLMStream(eng, completion, signal, onFinalStats) {
  let interrupted = false;
  for await (const chunk of completion) {
    if (signal?.aborted && !interrupted) {
      interrupted = true;
      eng.interruptGenerate();
    }
    if (interrupted) break;
    const text = chunk.choices?.[0]?.delta?.content || "";
    if (text) yield text;
    reportWebLLMFinalStats(chunk, onFinalStats);
  }
}

function webllmChatFn(eng, onFinalStats) {
  return async function* (prompt, { signal, system } = {}) {
    const messages = system
      ? [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ]
      : [{ role: "user", content: prompt }];
    const completion = await eng.chat.completions.create({
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_tokens: 2048,
    });
    yield* drainWebLLMStream(eng, completion, signal, onFinalStats);
  };
}

function transformersChatFn(eng) {
  return (prompt, { system } = {}) =>
    transformersChatStream(eng, prompt, { system });
}

// Provider dispatch shared by the single-shot offscreen routes: run fn with
// a chat closure for whichever engine the job names.
async function withProviderEngine(provider, model, fn) {
  if (provider === "transformers") {
    return withTransformersEngine(model, null, (eng) =>
      fn(transformersChatFn(eng)),
    );
  }
  return withEngine(model, (eng) => fn(webllmChatFn(eng)));
}

async function streamCompletion(
  eng,
  prompt,
  emit,
  signal,
  language,
  translateFn,
) {
  let serverStats = null;
  for await (const text of streamInTargetLanguage(
    webllmChatFn(eng, (s) => {
      serverStats = s;
    }),
    prompt,
    language,
    { signal, translateFn },
  )) {
    emit({ type: "chunk", text });
  }

  emit({ type: "done", serverStats });
}

function reportProgress(text, progress = 0) {
  chrome.runtime
    .sendMessage({
      target: "service-worker",
      type: "model-progress",
      progress: { text, progress },
    })
    .catch(() => {});
}

function opusProgressForReport(p) {
  reportProgress(p.text, p.progress ?? 0);
}

async function runSummarize(eng, pending, emit, signal) {
  let serverStats = null;
  async function* webllmChatStream(_host, _model, prompt, opts) {
    yield* webllmChatFn(eng, (s) => {
      serverStats = s;
    })(prompt, { signal, system: opts?.system });
  }

  const onProgress = (p) => {
    if (p.stage === "truncated") {
      reportProgress("Long page - summarizing the key parts.");
    } else if (p.stage === "reduce") {
      reportProgress("Merging summary...");
    } else if (p.stage === "translate") {
      reportProgress("Translating...");
    } else {
      reportProgress(`Summarizing part ${p.index + 1} of ${p.total}...`);
    }
  };

  const language = await resolveEffectiveLanguage(
    pending.content,
    pending.language,
  );
  const customInstructions = pending.customInstructions;
  for await (const token of summarizeText(
    {
      text: pending.content,
      title: pending.title,
      url: pending.url,
      mode: pending.mode,
      type: pending.type,
      model: pending.model,
      language,
      customInstructions,
      focusKeyword: pending.focusKeyword,
      signal,
    },
    {
      chatStreamFn: webllmChatStream,
      onProgress,
      translateFn: opusTranslateFnFor(
        pending.translationEngine,
        opusProgressForReport,
      ),
      selectChunksFn: (chunks, k) => selectSalientChunks(chunks, k),
    },
  )) {
    emit({ type: "chunk", text: token });
  }
  emit({ type: "done", serverStats });
}

const streams = new Map();

// Sliding expiry: every chunk of progress reschedules (slides) the timer,
// so a long map-reduce job that keeps emitting tokens never expires
// mid-generation; a stream with no progress for the full window is still
// reclaimed.
const streamExpiry = createSlidingExpiry({
  timeoutMs: STREAM_CLEANUP_MS,
  onExpire: (streamId) => {
    const stream = streams.get(streamId);
    if (!stream) return;
    streams.delete(streamId);
    disconnectStreamPorts(stream);
  },
});
function scheduleStreamCleanup(streamId) {
  streamExpiry.schedule(streamId);
}

async function runTransformersJob(
  pending,
  askPrompt,
  askLanguage,
  emit,
  signal,
) {
  const onDownloadProgress = (progress) => {
    chrome.runtime
      .sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress,
        modelId: pending.model,
        kind: "download",
      })
      .catch(() => {});
  };

  const tracker = createSummarizeProgressTracker((text) =>
    reportProgress(text),
  );

  const customInstructions = pending.customInstructions;

  await withTransformersEngine(
    pending.model,
    onDownloadProgress,
    async (eng) => {
      if (pending.action === "summarize") {
        const language = await resolveEffectiveLanguage(
          pending.content,
          pending.language,
        );
        const generator = summarizeText(
          {
            text: pending.content,
            title: pending.title,
            url: pending.url,
            mode: pending.mode,
            type: pending.type,
            model: pending.model,
            language,
            customInstructions,
            isSelection: pending.isSelection,
            focusKeyword: pending.focusKeyword,
            signal,
          },
          {
            translateFn: opusTranslateFnFor(
              pending.translationEngine,
              opusProgressForReport,
            ),
            selectChunksFn: (chunks, k) => selectSalientChunks(chunks, k),
            chatStreamFn: async function* (_host, _model, prompt, opts) {
              let count = 0;
              for await (const token of transformersChatStream(eng, prompt, {
                system: opts?.system,
              })) {
                if (signal?.aborted) return;
                count++;
                tracker.trackWord(count);
                yield token;
              }
            },
            onProgress: tracker.onProgress,
          },
        );
        for await (const token of generator) {
          emit({ type: "chunk", text: token });
        }
        emit({ type: "done" });
      } else if (pending.action === "ask") {
        for await (const token of streamInTargetLanguage(
          transformersChatFn(eng),
          askPrompt,
          askLanguage,
          {
            signal,
            translateFn: opusTranslateFnFor(
              pending.translationEngine,
              opusProgressForReport,
            ),
          },
        )) {
          if (signal?.aborted) break;
          emit({ type: "chunk", text: token });
        }
        emit({ type: "done" });
      } else {
        emit({ type: "error", error: `Unknown action: ${pending.action}` });
      }
    },
    { signal },
  );
}

async function runStream(streamId, pending, stream) {
  const controller = new AbortController();
  stream.controller = controller;

  const emit = (msg) => {
    if (stream.cancelled) return;
    if (msg.type === "chunk") {
      emitChunkToState(stream, msg.text || "", () =>
        scheduleStreamCleanup(streamId),
      );
      return;
    }
    if (msg.type === "done") {
      msg = finishStateWithStats(stream, msg);
    }
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.done = true;
    }
    broadcastToStream(stream, msg);

    if (
      msg.type === "done" &&
      pending.action === "summarize" &&
      pending.finalize
    ) {
      chrome.runtime
        .sendMessage({
          target: "service-worker",
          type: "stream-finished",
          streamId,
          finalize: pending.finalize,
          model: pending.model,
          title: pending.title,
          url: pending.url,
          text: stream.text,
        })
        .catch(() => {});
    }
  };

  try {
    let askPrompt = null;
    let askLanguage = "auto";
    if (pending.action === "ask") {
      const relevantContent = await retrieveRelevantContent({
        content: pending.content,
        question: pending.question,
      });
      const prompts = await getPrompts();
      askPrompt = prompts.withCustomInstructions(
        prompts.buildAnswerPrompt(
          pending.title,
          pending.url,
          relevantContent,
          pending.question,
        ),
        pending.customInstructions,
      );
      askLanguage = await resolveEffectiveLanguage(
        pending.content,
        pending.language,
      );
    }

    if (pending.provider === "transformers") {
      await runTransformersJob(
        pending,
        askPrompt,
        askLanguage,
        emit,
        controller.signal,
      );
    } else {
      await withEngine(
        pending.model,
        async (eng) => {
          switch (pending.action) {
            case "summarize":
              await runSummarize(eng, pending, emit, controller.signal);
              break;

            case "ask":
              await streamCompletion(
                eng,
                askPrompt,
                emit,
                controller.signal,
                askLanguage,
                opusTranslateFnFor(
                  pending.translationEngine,
                  opusProgressForReport,
                ),
              );
              break;

            default:
              emit({
                type: "error",
                error: `Unknown action: ${pending.action}`,
              });
          }
        },
        { ownerStreamId: streamId, signal: controller.signal },
      );
    }
  } catch (err) {
    if (stream.cancelled) return;
    const isOOM =
      /out of memory|oom|buffer allocation|gpubuffer|allocation failed|memory limit/i.test(
        err?.message || "",
      );
    if (isOOM) {
      resetEngineState();
    }
    emit({ type: "error", error: err.message });
    chrome.runtime
      .sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress: { text: toUserMessage(err), progress: 0 },
      })
      .catch(() => {});
  } finally {
    scheduleStreamCleanup(streamId);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  // Same sender validation as the onMessage handlers; unknown-name ports are
  // already dropped below.
  if (port.sender?.id !== chrome.runtime.id) {
    safeDisconnect(port);
    return;
  }
  // Stream ports are opened by the service-worker relay only; tab-hosted
  // contexts must not siphon stream text, mirroring the onMessage tab reject.
  if (port.sender?.tab) {
    safeDisconnect(port);
    return;
  }
  if (!port.name.startsWith("offscreen-stream-")) return;

  const streamId = port.name.replace("offscreen-stream-", "");
  const stream = streams.get(streamId);

  if (!stream) {
    safePost(port, {
      type: "error",
      error:
        "This response is no longer available (its stream expired). " +
        "Try summarizing again.",
      userFacing: true,
    });
    safeDisconnect(port);
    return;
  }

  stream.subscribers.add(port);
  replayStreamToPort(stream, port);

  port.onDisconnect.addListener(() => {
    stream.subscribers.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (sender?.id !== chrome.runtime.id) return false;

  // The service worker is the only legitimate sender (every target:
  // "offscreen" call site originates there). Tab-hosted contexts must not
  // invoke local-compute actions directly, so reject them outright rather
  // than allow-listing actions per sender.
  if (sender.tab) return false;

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          const streamId = message.streamId;
          const stream = createStreamState();
          streams.set(streamId, stream);
          scheduleStreamCleanup(streamId);
          sendResponse({ streamId });
          runStream(
            streamId,
            { action: message.action, ...message.payload },
            stream,
          );
          break;
        }

        case "cancel-stream": {
          const stream = streams.get(message.payload.streamId);
          if (stream && !stream.done) {
            stream.cancelled = true;
            stream.done = true;
            stream.text = "";
            broadcastToStream(stream, { type: "cancelled" });
            disconnectStreamPorts(stream);
            scheduleStreamCleanup(message.payload.streamId);
            try {
              stream.controller?.abort();
            } catch {
              // intent: best-effort, ignore if already closed/unavailable
            }
            if (engineOwnerStreamId === message.payload.streamId) {
              try {
                engine?.interruptGenerate?.();
              } catch {
                // intent: best-effort, ignore if already closed/unavailable
              }
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case "has-active-streams": {
          sendResponse({
            active: [...streams.values()].some((s) => !s.done),
          });
          break;
        }

        case "retrieve-context": {
          const { content, question } = message.payload;
          const relevantContent = await retrieveRelevantContent({
            content,
            question,
          });
          sendResponse({ content: relevantContent });
          break;
        }

        case "find-passage": {
          const { content, query } = message.payload;
          const passage = await findBestPassage({ content, query });
          sendResponse({ passage });
          break;
        }

        case "suggest-questions": {
          const {
            title,
            url,
            summary,
            model,
            provider,
            language,
            translationEngine,
            customInstructions,
            focusKeyword,
          } = message.payload;
          const prompts = await getPrompts();
          const prompt = prompts.buildSuggestQuestionsPrompt(
            title,
            url,
            summary,
            customInstructions,
            focusKeyword,
          );
          const qLanguage = await resolveEffectiveLanguage(summary, language);
          const translateFn = opusTranslateFnFor(
            translationEngine,
            opusProgressForReport,
          );
          const questions = await withProviderEngine(
            provider,
            model,
            async (chat) => {
              const text = await generateInTargetLanguage(
                chat,
                prompt,
                qLanguage,
                { translateFn },
              );
              return parseSuggestedQuestions(text);
            },
          );

          sendResponse({ questions });
          break;
        }

        // Single-shot (non-streaming) generation for multi-tab synthesis in
        // service-worker.js summarizeMultiTab, which combines several tabs
        // into one prompt and cannot use the streaming summarize/ask job
        // flow. Registered route: service-worker sends
        // { target: "offscreen", action: "generate-text" } for the
        // WebLLM/Transformers providers.
        case "generate-text": {
          const payload =
            message.payload && typeof message.payload === "object"
              ? message.payload
              : {};
          const { prompt, model, provider, language, translationEngine } =
            payload;
          if (typeof prompt !== "string" || !prompt.trim()) {
            sendResponse({ error: "generate-text requires a prompt" });
            break;
          }
          const qLanguage = await resolveEffectiveLanguage("", language);
          const translateFn = opusTranslateFnFor(
            translationEngine,
            opusProgressForReport,
          );
          const text = await withProviderEngine(
            provider,
            model,
            async (chat) => {
              return generateInTargetLanguage(chat, prompt, qLanguage, {
                translateFn,
              });
            },
          );
          sendResponse({ text });
          break;
        }

        case "status": {
          let webgpuAvailable = false;
          try {
            if (navigator.gpu) {
              const adapter = await navigator.gpu.requestAdapter();
              webgpuAvailable = adapter !== null;
            }
          } catch {
            // intent: best-effort, ignore if WebGPU check fails or is unavailable
          }
          sendResponse({
            ready: webgpuAvailable,
            currentModel: currentModelId,
            loading: loadingModelId,
          });
          break;
        }

        case "transformers-status": {
          const { currentModelId: tCurrent, loadingModelId: tLoading } =
            getTransformersStatus();
          sendResponse({
            ready: typeof WebAssembly !== "undefined",
            currentModel: tCurrent,
            loading: tLoading,
          });
          break;
        }

        case "check-webgpu": {
          if (!navigator.gpu) {
            sendResponse({
              supported: false,
              reason: "navigator.gpu is undefined",
            });
            break;
          }
          try {
            const adapter = await navigator.gpu.requestAdapter();

            sendResponse({
              supported: adapter !== null,
              reason: adapter ? "ok" : "no adapter",
            });
          } catch (err) {
            sendResponse({ supported: false, reason: err.message });
          }
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

chrome.runtime
  .sendMessage({
    target: "service-worker",
    type: "offscreen-ready",
  })
  .catch(() => {});
