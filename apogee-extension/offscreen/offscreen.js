import { parseSuggestedQuestions } from "../lib/summarize/questions.js";
import { summarizeText } from "../lib/summarize/ollamaSummarize.js";
import { resolveEffectiveLanguage } from "../lib/language/detectLanguage.js";
import {
  streamInTargetLanguage,
  generateInTargetLanguage,
} from "../lib/language/languageOutput.js";
import { makeOpusTranslateFn } from "../lib/language/opusTranslateEngine.js";
import {
  retrieveRelevantContent,
  findBestPassage,
  selectSalientChunks,
} from "../lib/retrieval/rag.js";
import { createLock } from "../lib/util/mutex.js";
import { WEBLLM_MODELS, TRANSLATION_ENGINES } from "../lib/constants.js";
import {
  withTransformersEngine,
  transformersChatStream,
  getTransformersStatus,
} from "../lib/engines/transformersEngine.js";
import { initDebugLogging } from "../lib/util/log.js";
import { broadcastToStream } from "../lib/util/streamBroadcast.js";
import {
  tokensForChunk,
  isWarmedUp,
  tokensPerSecond,
  finalTokensPerSecond,
} from "../lib/util/throughput.js";

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
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine) {
    try {
      await engine.unload();
    } catch {}
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
      })
      .catch(() => {});
  };

  const STALL_NOTE_MS = 45 * 1000;
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
    for (let attempt = 1; ; attempt++) {
      try {
        engine = await CreateMLCEngine(modelId, engineOptions);
        break;
      } catch (err) {
        console.error(`Model load attempt ${attempt} failed:`, err);
        if (!isInterruptedDownloadError(err)) throw err;
        if (attempt >= MAX_DOWNLOAD_ATTEMPTS) {
          throw new Error(
            "The model download keeps getting interrupted (the download " +
              "server stalled or the connection dropped). Progress so far " +
              "is saved, so trying again later will resume where it left " +
              "off.",
            { cause: err },
          );
        }
        sendProgress({
          progress: 0,
          text: `Download hiccup - retrying (attempt ${attempt + 1} of ${MAX_DOWNLOAD_ATTEMPTS})...`,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
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

async function withEngine(modelId, fn, ownerStreamId = null) {
  const release = await acquireLock();
  engineOwnerStreamId = ownerStreamId;
  try {
    const eng = await ensureEngine(modelId);
    return await fn(eng);
  } catch (err) {
    resetEngineState();
    throw err;
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
    if (interrupted) continue;
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

function opusTranslateFor(translationEngine) {
  if (translationEngine !== TRANSLATION_ENGINES.OPUS) return undefined;
  return makeOpusTranslateFn((p) => reportProgress(p.text, p.progress ?? 0));
}

async function runSummarize(eng, pending, emit, signal) {
  let serverStats = null;
  async function* webllmChatStream(_host, _model, prompt, opts) {
    const messages = opts?.system
      ? [
          { role: "system", content: opts.system },
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
    yield* drainWebLLMStream(eng, completion, signal, (s) => {
      serverStats = s;
    });
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
      signal,
    },
    {
      chatStreamFn: webllmChatStream,
      onProgress,
      translateFn: opusTranslateFor(pending.translationEngine),
      selectChunksFn: (chunks, k) => selectSalientChunks(chunks, k),
    },
  )) {
    emit({ type: "chunk", text: token });
  }
  emit({ type: "done", serverStats });
}

const streams = new Map();

const STREAM_CLEANUP_MS = 2 * 60 * 1000;
function scheduleStreamCleanup(streamId) {
  setTimeout(() => {
    const stream = streams.get(streamId);
    if (!stream) return;
    streams.delete(streamId);
    for (const port of stream.subscribers) {
      try {
        port.disconnect();
      } catch {}
    }
  }, STREAM_CLEANUP_MS);
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
      })
      .catch(() => {});
  };

  let longNote = "";
  let stageLabel = "Summarizing...";

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
            signal,
          },
          {
            translateFn: opusTranslateFor(pending.translationEngine),
            selectChunksFn: (chunks, k) => selectSalientChunks(chunks, k),
            chatStreamFn: async function* (_host, _model, prompt, opts) {
              let count = 0;
              for await (const token of transformersChatStream(eng, prompt, {
                system: opts?.system,
              })) {
                if (signal?.aborted) return;
                count++;
                if (count % 24 === 0) {
                  reportProgress(`${longNote}${stageLabel} (${count} words)`);
                }
                yield token;
              }
            },
            onProgress: (p) => {
              if (p.stage === "truncated") {
                longNote = "Long page - summarizing the key parts. ";
                reportProgress(longNote.trim());
                return;
              }
              if (p.stage === "reduce") stageLabel = "Merging summary...";
              else if (p.stage === "translate") stageLabel = "Translating...";
              else
                stageLabel = `Summarizing part ${p.index + 1} of ${p.total}...`;
              reportProgress(longNote + stageLabel);
            },
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
          { signal, translateFn: opusTranslateFor(pending.translationEngine) },
        )) {
          if (signal?.aborted) break;
          emit({ type: "chunk", text: token });
        }
        emit({ type: "done" });
      } else {
        emit({ type: "error", error: `Unknown action: ${pending.action}` });
      }
    },
  );
}

async function runStream(streamId, pending, stream) {
  const controller = new AbortController();
  stream.controller = controller;

  const emit = (msg) => {
    if (stream.cancelled) return;
    if (msg.type === "chunk") {
      stream.text += msg.text || "";
      if (stream.firstTokenTime == null) {
        stream.firstTokenTime = performance.now();
      }
      stream.tokenCount += tokensForChunk(msg.text);
    }
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
      stream.done = true;
    }
    broadcastToStream(stream, msg);
    if (msg.type === "chunk" && stream.firstTokenTime != null) {
      const elapsedMs = performance.now() - stream.firstTokenTime;
      if (isWarmedUp(stream.tokenCount, elapsedMs)) {
        broadcastToStream(stream, {
          type: "stats",
          tokensPerSec: tokensPerSecond(stream.tokenCount, elapsedMs),
        });
      }
    }

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
                opusTranslateFor(pending.translationEngine),
              );
              break;

            default:
              emit({
                type: "error",
                error: `Unknown action: ${pending.action}`,
              });
          }
        },
        streamId,
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
        progress: { text: `Error: ${err.message}`, progress: 0 },
      })
      .catch(() => {});
  } finally {
    scheduleStreamCleanup(streamId);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("offscreen-stream-")) return;

  const streamId = port.name.replace("offscreen-stream-", "");
  const stream = streams.get(streamId);

  if (!stream) {
    try {
      port.postMessage({
        type: "error",
        error:
          "This response is no longer available (its stream expired). " +
          "Try summarizing again.",
      });
    } catch {}
    try {
      port.disconnect();
    } catch {}
    return;
  }

  stream.subscribers.add(port);
  if (stream.text) {
    try {
      port.postMessage({ type: "chunk", text: stream.text });
    } catch {}
  }
  if (stream.cancelled) {
    try {
      port.postMessage({ type: "cancelled" });
    } catch {}
  } else if (stream.error) {
    try {
      port.postMessage({ type: "error", error: stream.error });
    } catch {}
  } else if (stream.done) {
    try {
      port.postMessage({ type: "done", tokensPerSec: stream.tokensPerSec });
    } catch {}
  } else if (stream.firstTokenTime != null) {
    const elapsedMs = performance.now() - stream.firstTokenTime;
    if (isWarmedUp(stream.tokenCount, elapsedMs)) {
      try {
        port.postMessage({
          type: "stats",
          tokensPerSec: tokensPerSecond(stream.tokenCount, elapsedMs),
        });
      } catch {}
    }
  }

  port.onDisconnect.addListener(() => {
    stream.subscribers.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (sender.id !== chrome.runtime.id) return false;

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          const streamId = message.streamId;
          const stream = {
            text: "",
            done: false,
            error: null,
            cancelled: false,
            subscribers: new Set(),
            tokenCount: 0,
            firstTokenTime: null,
            tokensPerSec: null,
          };
          streams.set(streamId, stream);
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
            try {
              stream.controller?.abort();
            } catch {}
            if (engineOwnerStreamId === message.payload.streamId) {
              try {
                engine?.interruptGenerate?.();
              } catch {}
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
          } = message.payload;
          const prompts = await getPrompts();
          const prompt = prompts.buildSuggestQuestionsPrompt(
            title,
            url,
            summary,
          );
          const qLanguage = await resolveEffectiveLanguage(summary, language);
          const translateFn = opusTranslateFor(translationEngine);
          const questions =
            provider === "transformers"
              ? await withTransformersEngine(model, null, async (eng) => {
                  const text = await generateInTargetLanguage(
                    transformersChatFn(eng),
                    prompt,
                    qLanguage,
                    { translateFn },
                  );
                  return parseSuggestedQuestions(text);
                })
              : await withEngine(model, async (eng) => {
                  const text = await generateInTargetLanguage(
                    webllmChatFn(eng),
                    prompt,
                    qLanguage,
                    { translateFn },
                  );
                  return parseSuggestedQuestions(text);
                });

          sendResponse({ questions });
          break;
        }

        case "generate-text": {
          const { prompt, model, provider, language, translationEngine } =
            message.payload;
          const qLanguage = await resolveEffectiveLanguage("", language);
          const translateFn = opusTranslateFor(translationEngine);
          const text =
            provider === "transformers"
              ? await withTransformersEngine(model, null, async (eng) => {
                  return generateInTargetLanguage(
                    transformersChatFn(eng),
                    prompt,
                    qLanguage,
                    { translateFn },
                  );
                })
              : await withEngine(model, async (eng) => {
                  return generateInTargetLanguage(
                    webllmChatFn(eng),
                    prompt,
                    qLanguage,
                    { translateFn },
                  );
                });
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
          } catch {}
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
