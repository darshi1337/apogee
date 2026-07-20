// Offscreen document, WebGPU execution context for MLCEngine.
// Receives messages from the service worker, runs inference, and streams tokens back via chrome.runtime port connections.
// IMPORTANT: We use dynamic imports for @mlc-ai/web-llm and prompt helpers so that message handlers (especially check-webgpu) register immediately without waiting for the heavy ~6 MB web-llm module to load. If the static import fails at the top level, the entire module dies and no handlers register,this was the root cause of the false "WebGPU not supported" bug.

import { parseSuggestedQuestions } from "../lib/questions.js";
import { summarizeText } from "../lib/ollamaSummarize.js";
import { retrieveRelevantContent } from "../lib/rag.js";

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

async function streamCompletion(eng, prompt, emit, signal) {
  const chunks = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    stream: true,
    temperature: 0.3,
    max_tokens: 2048,
  });

  for await (const chunk of chunks) {
    // A cancel already broadcasts its own "cancelled" message and calls
    // engine.interruptGenerate() directly (see the "cancel-stream" handler
    // below); this just stops relaying further tokens once that's happened,
    // it isn't itself responsible for emitting the terminal message.
    if (signal?.aborted) return;
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

// Chunk-aware summarization for the small in-browser models, delegated to the
// shared summarizeText core (lib/ollamaSummarize.js) so WebLLM and Ollama
// produce identical output for the same page. summarizeText owns the
// chunking + map-reduce/bullets logic; here we only adapt the WebLLM engine
// to look like an Ollama-style token stream and forward its tokens.
//
// This deliberately replaces the old private map-reduce that re-summarized
// every mode (including bullets) down to a single fixed-size pass: for a long
// PDF that reduce step collapsed the whole document into ~8-14 bullets (often
// far fewer). summarizeText instead streams each chunk's bullets through for
// bullets mode, so the summary now scales with document length.
async function runSummarize(eng, pending, emit, signal) {
  // Presents the WebLLM engine as summarizeText's chatStreamFn seam. The
  // host/model args come baked into the prompt already, so they're ignored.
  async function* webllmChatStream(_host, _model, prompt) {
    const completion = await eng.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      stream: true,
      temperature: 0.3,
      max_tokens: 2048,
    });
    for await (const chunk of completion) {
      if (signal?.aborted) return;
      const text = chunk.choices?.[0]?.delta?.content || "";
      if (text) yield text;
    }
  }

  const onProgress = (p) => {
    if (p.stage === "reduce") {
      reportProgress("Merging summary...");
    } else {
      reportProgress(`Summarizing part ${p.index + 1} of ${p.total}...`);
    }
  };

  for await (const token of summarizeText(
    {
      text: pending.content,
      title: pending.title,
      url: pending.url,
      mode: pending.mode,
      model: pending.model,
      signal,
    },
    { chatStreamFn: webllmChatStream, onProgress },
  )) {
    emit({ type: "chunk", text: token });
  }
  emit({ type: "done" });
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
  // A separate signal from the engine lock/WebGPU device itself: cancel
  // needs both this (so summarizeText and the chat-stream wrappers above
  // stop asking for more tokens) and engine.interruptGenerate() (so the
  // *current* in-flight generation actually stops producing them), see the
  // "cancel-stream" handler below.
  const controller = new AbortController();
  stream.controller = controller;

  const emit = (msg) => {
    // Once cancelled, the "cancelled" handler already broadcast the terminal
    // message itself; ignore anything the job emits afterward (e.g. a late
    // "done" from a chunk that was mid-flight when interruptGenerate() was
    // called) so it can't clobber the cancelled state.
    if (stream.cancelled) return;
    if (msg.type === "chunk") stream.text += msg.text || "";
    if (msg.type === "done") stream.done = true;
    if (msg.type === "error") {
      stream.error = msg.error;
      stream.done = true;
    }
    broadcastToStream(stream, msg);
  };

  try {
    // Computed outside withEngine: it's WASM/CPU work (see lib/embeddings.js),
    // unrelated to the WebGPU engine the lock exists to serialize, so it
    // shouldn't sit blocked behind (or block) another engine operation.
    let askPrompt = null;
    if (pending.action === "ask") {
      const relevantContent = await retrieveRelevantContent({
        content: pending.content,
        question: pending.question,
      });
      const prompts = await getPrompts();
      askPrompt = prompts.buildAnswerPrompt(
        pending.title,
        pending.url,
        relevantContent,
        pending.question,
      );
    }

    await withEngine(pending.model, async (eng) => {
      switch (pending.action) {
        case "summarize":
          await runSummarize(eng, pending, emit, controller.signal);
          break;

        case "ask":
          await streamCompletion(eng, askPrompt, emit, controller.signal);
          break;

        default:
          emit({ type: "error", error: `Unknown action: ${pending.action}` });
      }
    });
  } catch (err) {
    if (stream.cancelled) return;
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
      port.postMessage({ type: "done" });
    } catch {}
  }

  port.onDisconnect.addListener(() => {
    stream.subscribers.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  // Same own-extension check as the service worker's listener: only this
  // extension's contexts may drive inference here.
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

        case "cancel-stream": {
          const stream = streams.get(message.payload.streamId);
          if (stream && !stream.done) {
            stream.cancelled = true;
            stream.done = true;
            broadcastToStream(stream, { type: "cancelled" });
            // Stops summarizeText/streamCompletion from asking for more
            // chunks; interruptGenerate() stops the *current* one, the one
            // already in flight when cancel was clicked, immediately.
            try {
              stream.controller?.abort();
            } catch {}
            try {
              engine?.interruptGenerate?.();
            } catch {}
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

        // Used by the Local Ollama "ask" path (background/service-worker.js's
        // getRelevantAskContent): that path builds its own prompt and streams
        // from Ollama directly rather than through this document's engine, it
        // only needs the relevant-content selection itself, which requires
        // the embedding model's dynamic import(), disallowed in the service
        // worker's ServiceWorkerGlobalScope by spec (see lib/embeddings.js).
        case "retrieve-context": {
          const { content, question } = message.payload;
          const relevantContent = await retrieveRelevantContent({
            content,
            question,
          });
          sendResponse({ content: relevantContent });
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
