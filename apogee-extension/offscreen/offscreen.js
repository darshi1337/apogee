// Offscreen document — WebGPU execution context for MLCEngine.
// Receives messages from the service worker, runs inference, and streams tokens back via chrome.runtime port connections.
// IMPORTANT: We use dynamic imports for @mlc-ai/web-llm and prompt helpers so that message handlers (especially check-webgpu) register immediately without waiting for the heavy ~6 MB web-llm module to load. If the static import fails at the top level, the entire module dies and no handlers register,this was the root cause of the false "WebGPU not supported" bug.

import { chunkText, truncateForPrompt } from "../lib/chunk.js";

// Forward all console logs to the service worker for remote debugging
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

function sendLogToServiceWorker(level, args) {
  const message = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === "object") {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }
    return String(arg);
  }).join(" ");

  chrome.runtime.sendMessage({
    target: "service-worker",
    type: "offscreen-log",
    level,
    message,
  }).catch(() => {});
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
  console.error("Global error in offscreen document:", event.message, "at", event.filename, ":", event.lineno);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in offscreen document:", event.reason?.stack || event.reason?.message || event.reason);
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
      cacheBackend: "cache"
    }
  });

  currentModelId = modelId;
  loadingModelId = null;
  return engine;
}

async function streamCompletion(eng, prompt, port, isDisconnected) {
  const chunks = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    stream: true,
    temperature: 0.3,
    max_tokens: 2048,
  });

  for await (const chunk of chunks) {
    if (isDisconnected()) break;
    const text = chunk.choices?.[0]?.delta?.content || "";
    if (text) {
      try {
        port.postMessage({ type: "chunk", text });
      } catch {
        break;
      }
    }
  }

  if (!isDisconnected()) {
    try {
      port.postMessage({ type: "done" });
    } catch {}
  }
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
async function runSummarize(eng, prompts, pending, port, isDisconnected) {
  const chunks = chunkText(pending.content);

  if (chunks.length <= 1) {
    const prompt = prompts.buildSummaryPrompt(
      pending.title,
      pending.url,
      chunks[0] || pending.content || "",
      pending.mode,
    );
    await streamCompletion(eng, prompt, port, isDisconnected);
    return;
  }

  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    if (isDisconnected()) return;
    reportProgress(`Summarizing part ${i + 1} of ${chunks.length}...`);
    const prompt = prompts.buildSummaryPrompt(
      pending.title,
      pending.url,
      chunks[i],
      pending.mode,
    );
    partials.push((await generateText(eng, prompt, 1024)).trim());
  }

  if (isDisconnected()) return;
  reportProgress("Merging summary...");
  const mergePrompt = prompts.buildSummaryPrompt(
    pending.title,
    pending.url,
    partials.join("\n"),
    pending.mode,
  );
  await streamCompletion(eng, mergePrompt, port, isDisconnected);
}

const pendingStreams = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("offscreen-stream-")) return;

  const streamId = port.name.replace("offscreen-stream-", "");
  const pending = pendingStreams.get(streamId);

  if (!pending) {
    try {
      port.postMessage({ type: "error", error: "Unknown stream ID" });
    } catch {}
    try {
      port.disconnect();
    } catch {}
    return;
  }

  pendingStreams.delete(streamId);

  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
  });

  (async () => {
    const release = await acquireLock();
    try {
      if (disconnected) return;
      const eng = await ensureEngine(pending.model);
      if (disconnected) return;
      const prompts = await getPrompts();

      switch (pending.action) {
        case "summarize":
          await runSummarize(eng, prompts, pending, port, () => disconnected);
          break;

        case "ask": {
          const prompt = prompts.buildAnswerPrompt(
            pending.title,
            pending.url,
            truncateForPrompt(pending.content),
            pending.question,
          );
          if (disconnected) return;
          await streamCompletion(eng, prompt, port, () => disconnected);
          break;
        }

        default:
          if (!disconnected) {
            try {
              port.postMessage({
                type: "error",
                error: `Unknown action: ${pending.action}`,
              });
            } catch {}
            try {
              port.disconnect();
            } catch {}
          }
          return;
      }
    } catch (err) {
      if (!disconnected) {
        try {
          port.postMessage({ type: "error", error: err.message });
        } catch {}
        chrome.runtime
          .sendMessage({
            target: "service-worker",
            type: "model-progress",
            progress: { text: `Error: ${err.message}`, progress: 0 },
          })
          .catch(() => {});
      }
    } finally {
      release();
    }
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          const streamId = message.streamId;
          pendingStreams.set(streamId, {
            action: message.action,
            ...message.payload,
          });
          sendResponse({ streamId });
          break;
        }

        case "suggest-questions": {
          const { title, url, summary, model } = message.payload;
          const release = await acquireLock();
          try {
            const eng = await ensureEngine(model);
            const prompts = await getPrompts();
            const prompt = prompts.buildSuggestQuestionsPrompt(
              title,
              url,
              summary,
            );
            const text = await generateText(eng, prompt);

            const cleaned = text
              .replace(/<think>[\s\S]*?<\/think>/gi, "")
              .replace(/<think>[\s\S]*/gi, "");
            const questions = cleaned
              .split("\n")
              .map((line) =>
                line
                  .trim()
                  .replace(/^[-*•\d.)]+\s*/, "")
                  .trim(),
              )
              .filter((line) => line.length > 0 && line.endsWith("?"))
              .slice(0, 2);

            sendResponse({ questions });
          } finally {
            release();
          }
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
          const release = await acquireLock();
          try {
            await ensureEngine(message.payload.model);
            sendResponse({ ready: true, currentModel: currentModelId });
          } finally {
            release();
          }
          break;
        }

        case "unload-model": {
          const release = await acquireLock();
          try {
            if (engine) {
              await engine.unload();
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
