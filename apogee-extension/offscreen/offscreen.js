// Offscreen document — WebGPU execution context for MLCEngine.
// Receives messages from the service worker, runs inference, and streams tokens back via chrome.runtime port connections.
// IMPORTANT: We use dynamic imports for @mlc-ai/web-llm and prompt helpers so that message handlers (especially check-webgpu) register immediately without waiting for the heavy ~6 MB web-llm module to load. If the static import fails at the top level, the entire module dies and no handlers register,this was the root cause of the false "WebGPU not supported" bug.

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

  const { CreateMLCEngine } = await getWebLLM();

  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      chrome.runtime.sendMessage({
        target: "service-worker",
        type: "model-progress",
        progress: report,
        modelId,
      });
    },
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

async function generateText(eng, prompt) {
  const reply = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 512,
  });

  return reply.choices?.[0]?.message?.content || "";
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
      let prompt;

      switch (pending.action) {
        case "summarize":
          prompt = prompts.buildSummaryPrompt(
            pending.title,
            pending.url,
            pending.content,
            pending.mode,
          );
          break;

        case "ask":
          prompt = prompts.buildAnswerPrompt(
            pending.title,
            pending.url,
            pending.content,
            pending.question,
          );
          break;

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

      if (disconnected) return;
      await streamCompletion(eng, prompt, port, () => disconnected);
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
              .filter((line) => line.length > 0)
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
