// Offscreen document, WebGPU execution context for MLCEngine.
// Receives messages from the service worker, runs inference, and streams tokens back via chrome.runtime port connections.
// IMPORTANT: We use dynamic imports for @mlc-ai/web-llm and prompt helpers so that message handlers (especially check-webgpu) register immediately without waiting for the heavy ~6 MB web-llm module to load. If the static import fails at the top level, the entire module dies and no handlers register,this was the root cause of the false "WebGPU not supported" bug.

import { chunkText, truncateForPrompt } from "../lib/chunk.js";
import { parseSuggestedQuestions } from "../lib/questions.js";

// Forward all console logs to the service worker for remote debugging
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

// Serialization Mutex for the WebLLM engine:
// Because MLCEngine / WebGPU is highly stateful, running overlapping model operations (such as starting a new inference task or suggestions while a previous inference stream is finishing, or loading/unloading models concurrently) can corrupt the WebGPU device context and throw "Buffer was unmapped before mapping was resolved" errors.
// This Promise chain acts as a mutex to guarantee only one engine operation runs at a time.
let engineLock = Promise.resolve();

async function acquireLock() {
  let release;
  const nextLock = new Promise((resolve) => {
    release = resolve;
  });
  const currentLock = engineLock;
  engineLock = nextLock;
  await currentLock;
  return release;
}

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
    _prompts = await import("../lib/prompts.js");
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
    } catch {
      // ignore
    }
    engine = null;
    currentModelId = null;
  }

  loadingModelId = modelId;

  const { CreateMLCEngine, prebuiltAppConfig } = await getWebLLM();

  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      chrome.runtime.sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress: report,
        modelId,
      });
    },
    appConfig: {
      ...prebuiltAppConfig,
      cacheBackend: "cache",
    },
  });

  currentModelId = modelId;
  loadingModelId = null;
  return engine;
}

// ensureEngine's fast path trusts currentModelId and hands back the cached
// engine without checking it's still healthy. If a prior operation crashed
// the WebGPU device (e.g. the "Buffer was unmapped..." class of error) but
// left engine/currentModelId untouched, every subsequent call would keep
// reusing the now-broken engine and fail with WebLLM's "Model not loaded"
// error forever, until the extension was reloaded. Any caller that touches
// the engine must go through this so a failure forces a full reload next time.
function resetEngineState() {
  engine = null;
  currentModelId = null;
  loadingModelId = null;
}

async function withEngine(modelId, fn) {
  const release = await acquireLock();
  try {
    const eng = await ensureEngine(modelId);
    return await fn(eng);
  } catch (err) {
    resetEngineState();
    throw err;
  } finally {
    release();
  }
}

async function streamCompletion(eng, prompt, emit) {
  const chunks = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    stream: true,
    temperature: 0.3,
    max_tokens: 2048,
  });

  for await (const chunk of chunks) {
    const text = chunk.choices?.[0]?.delta?.content || "";
    if (text) emit({ type: "chunk", text });
  }

  emit({ type: "done" });
}

async function generateText(eng, prompt, maxTokens = 512) {
  const reply = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: maxTokens,
  });

  return reply.choices?.[0]?.message?.content || "";
}

function reportProgress(text) {
  chrome.runtime
    .sendMessage({
      target: "service-worker",
      type: "model-progress",
      progress: { text, progress: 0 },
    })
    .catch(() => {});
}

// Chunk-aware summarization for the small in-browser models. Long pages are
// split into context-sized chunks; each chunk is summarized independently and
// the partial summaries are merged in a final streamed pass (map-reduce),
// mirroring the backend's behavior. Short pages stream directly.
async function runSummarize(eng, prompts, pending, emit) {
  const chunks = chunkText(pending.content);

  if (chunks.length <= 1) {
    const prompt = prompts.buildSummaryPrompt(
      pending.title,
      pending.url,
      chunks[0] || pending.content || "",
      pending.mode,
    );
    await streamCompletion(eng, prompt, emit);
    return;
  }

  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    reportProgress(`Summarizing part ${i + 1} of ${chunks.length}...`);
    const prompt = prompts.buildSummaryPrompt(
      pending.title,
      pending.url,
      chunks[i],
      pending.mode,
    );
    partials.push((await generateText(eng, prompt, 1536)).trim());
  }

  reportProgress("Merging summary...");
  const mergePrompt = prompts.buildSummaryPrompt(
    pending.title,
    pending.url,
    partials.join("\n"),
    pending.mode,
  );
  await streamCompletion(eng, mergePrompt, emit);
}

// Stream jobs, keyed by streamId, buffered here rather than in the service
// worker: the SW gets evicted after ~30s of inactivity (e.g. a long model
// download with sparse progress ticks, or the popup closing on blur), which
// wipes any in-memory Map it holds. This offscreen document has no such
// automatic eviction, it only closes via our own explicit idle-close logic
// in the service worker, so it's the durable side to own the buffer and
// keep generating even while nothing is listening.
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

function broadcastToStream(stream, msg) {
  for (const port of stream.subscribers) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

// Runs a generation job to completion, independent of any subscriber port,
// started as soon as the job is requested rather than waiting for the
// service worker to attach a relay port, so a popup closing (or the SW
// restarting) mid-generation no longer aborts the job.
async function runStream(streamId, pending, stream) {
  const emit = (msg) => {
    if (msg.type === "chunk") stream.text += msg.text || "";
    if (msg.type === "done") stream.done = true;
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.done = true;
    }
    broadcastToStream(stream, msg);
  };

  try {
    await withEngine(pending.model, async (eng) => {
      const prompts = await getPrompts();

      switch (pending.action) {
        case "summarize":
          await runSummarize(eng, prompts, pending, emit);
          break;

        case "ask": {
          const prompt = prompts.buildAnswerPrompt(
            pending.title,
            pending.url,
            truncateForPrompt(pending.content),
            pending.question,
          );
          await streamCompletion(eng, prompt, emit);
          break;
        }

        default:
          emit({ type: "error", error: `Unknown action: ${pending.action}` });
      }
    });
  } catch (err) {
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
      port.postMessage({ type: "error", error: "Unknown or expired stream" });
    } catch {}
    try {
      port.disconnect();
    } catch {}
    return;
  }

  // Subscribing just replays what's buffered so far, then relays live
  // chunks, it never starts or restarts the underlying job.
  stream.subscribers.add(port);
  if (stream.text) {
    try {
      port.postMessage({ type: "chunk", text: stream.text });
    } catch {}
  }
  if (stream.error) {
    try {
      port.postMessage({ type: "error", error: stream.error });
    } catch {}
  } else if (stream.done) {
    try {
      port.postMessage({ type: "done" });
    } catch {}
  }

  port.onDisconnect.addListener(() => {
    stream.subscribers.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

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
            subscribers: new Set(),
          };
          streams.set(streamId, stream);
          sendResponse({ streamId });
          // Not awaited: the job runs independently of this message/response
          // and of any port ever attaching to it.
          runStream(
            streamId,
            { action: message.action, ...message.payload },
            stream,
          );
          break;
        }

        case "has-active-streams": {
          sendResponse({
            active: [...streams.values()].some((s) => !s.done),
          });
          break;
        }

        case "suggest-questions": {
          const { title, url, summary, model } = message.payload;
          const questions = await withEngine(model, async (eng) => {
            const prompts = await getPrompts();
            const prompt = prompts.buildSuggestQuestionsPrompt(
              title,
              url,
              summary,
            );
            const text = await generateText(eng, prompt);
            return parseSuggestedQuestions(text);
          });

          sendResponse({ questions });
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
            // WebGPU probe failed
          }
          sendResponse({
            ready: webgpuAvailable,
            currentModel: currentModelId,
            loading: loadingModelId,
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

        case "load-model": {
          await withEngine(message.payload.model, async () => {});
          sendResponse({ ready: true, currentModel: currentModelId });
          break;
        }

        case "unload-model": {
          const release = await acquireLock();
          try {
            if (engine) {
              try {
                await engine.unload();
              } catch (err) {
                console.error("Error unloading engine:", err);
              }
              engine = null;
              currentModelId = null;
            }
            sendResponse({ ready: false });
          } finally {
            release();
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
