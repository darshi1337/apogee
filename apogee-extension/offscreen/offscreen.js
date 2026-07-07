// Offscreen document — WebGPU execution context for MLCEngine.
// Receives messages from the service worker, runs inference, and streams
// tokens back via chrome.runtime port connections.

import { CreateMLCEngine } from "@mlc-ai/web-llm";
import {
  buildSummaryPrompt,
  buildAnswerPrompt,
  buildSuggestQuestionsPrompt,
} from "../lib/prompts.js";

let engine = null;
let currentModelId = null;
let loadingModelId = null;

// ─── Engine lifecycle ────────────────────────────────────────────────────────

async function ensureEngine(modelId) {
  if (engine && currentModelId === modelId) {
    return engine;
  }

  // If a different model is loading or loaded, tear it down
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

  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      // Forward download/init progress to the service worker
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

// ─── Inference helpers ───────────────────────────────────────────────────────

async function streamCompletion(eng, prompt, port) {
  const chunks = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    stream: true,
    temperature: 0.3,
    max_tokens: 2048,
  });

  for await (const chunk of chunks) {
    const text = chunk.choices?.[0]?.delta?.content || "";
    if (text) {
      port.postMessage({ type: "chunk", text });
    }
  }

  port.postMessage({ type: "done" });
}

async function generateText(eng, prompt) {
  const reply = await eng.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 512,
  });

  return reply.choices?.[0]?.message?.content || "";
}

// ─── Message handlers ────────────────────────────────────────────────────────

// Stream-based actions use port connections.
// The service worker opens a port named `stream-{streamId}` and the offscreen
// doc streams tokens back through it.

const pendingStreams = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("stream-")) return;

  const streamId = port.name.replace("stream-", "");
  const pending = pendingStreams.get(streamId);

  if (!pending) {
    port.postMessage({ type: "error", error: "Unknown stream ID" });
    port.disconnect();
    return;
  }

  pendingStreams.delete(streamId);

  // Run the stream
  (async () => {
    try {
      const eng = await ensureEngine(pending.model);
      let prompt;

      switch (pending.action) {
        case "summarize":
          prompt = buildSummaryPrompt(
            pending.title,
            pending.url,
            pending.content,
            pending.mode,
          );
          break;

        case "ask":
          prompt = buildAnswerPrompt(
            pending.title,
            pending.url,
            pending.content,
            pending.question,
          );
          break;

        default:
          port.postMessage({ type: "error", error: `Unknown action: ${pending.action}` });
          port.disconnect();
          return;
      }

      await streamCompletion(eng, prompt, port);
    } catch (err) {
      try {
        port.postMessage({ type: "error", error: err.message });
      } catch {
        // port may already be disconnected
      }
    }
  })();
});

// Non-streaming messages come through chrome.runtime.onMessage.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  const handler = async () => {
    try {
      switch (message.action) {
        case "summarize":
        case "ask": {
          // Register a pending stream — the service worker will connect a port
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
          const eng = await ensureEngine(model);
          const prompt = buildSuggestQuestionsPrompt(title, url, summary);
          const text = await generateText(eng, prompt);

          // Parse two questions from the output
          const questions = text
            .split("\n")
            .map((line) => line.trim().replace(/^[-*•\d.)]+\s*/, "").trim())
            .filter((line) => line.length > 0)
            .slice(0, 2);

          sendResponse({ questions });
          break;
        }

        case "status": {
          sendResponse({
            ready: engine !== null && currentModelId !== null,
            currentModel: currentModelId,
            loading: loadingModelId,
          });
          break;
        }

        case "load-model": {
          await ensureEngine(message.payload.model);
          sendResponse({ ready: true, currentModel: currentModelId });
          break;
        }

        case "unload-model": {
          if (engine) {
            await engine.unload();
            engine = null;
            currentModelId = null;
          }
          sendResponse({ ready: false });
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
  return true; // async sendResponse
});
