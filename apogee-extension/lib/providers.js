// Provider abstraction — routes inference requests to either WebLLM
// (in-browser via offscreen document) or Local Ollama backend.

import { PROVIDERS, DEFAULT_LOCAL_API_BASE } from "./constants.js";

// ─── Message-based WebLLM provider ───────────────────────────────────────────
// Sends requests to the service worker, which forwards to the offscreen doc.

function sendToServiceWorker(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Stream tokens from WebLLM via the service worker.
 * Yields string chunks as they arrive via message-based streaming.
 */
async function* webllmStreamTokens(action, payload) {
  // Send the initial request, get a stream ID back
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action,
    payload,
  });

  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }

  // Poll for streamed chunks via a port-based connection
  const port = chrome.runtime.connect({ name: `stream-${streamId}` });
  let done = false;
  const chunks = [];
  let resolveChunk = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === "chunk") {
      if (resolveChunk) {
        const r = resolveChunk;
        resolveChunk = null;
        r(msg.text);
      } else {
        chunks.push(msg.text);
      }
    } else if (msg.type === "done") {
      done = true;
      if (resolveChunk) {
        const r = resolveChunk;
        resolveChunk = null;
        r(null);
      }
    } else if (msg.type === "error") {
      done = true;
      if (resolveChunk) {
        const r = resolveChunk;
        resolveChunk = null;
        r(null);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    done = true;
    if (resolveChunk) {
      const r = resolveChunk;
      resolveChunk = null;
      r(null);
    }
  });

  while (!done) {
    if (chunks.length > 0) {
      yield chunks.shift();
    } else {
      const text = await new Promise((resolve) => {
        resolveChunk = resolve;
      });
      if (text === null) break;
      yield text;
    }
  }

  port.disconnect();
}

class WebLLMProvider {
  constructor(model) {
    this.model = model;
  }

  /**
   * @returns {AsyncGenerator<string>} token stream
   */
  async *summarize({ title, url, content, mode }) {
    yield* webllmStreamTokens("summarize", {
      title,
      url,
      content,
      mode,
      model: this.model,
    });
  }

  async *ask({ title, url, content, question }) {
    yield* webllmStreamTokens("ask", {
      title,
      url,
      content,
      question,
      model: this.model,
    });
  }

  async suggestQuestions({ title, url, summary }) {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "suggest-questions",
      payload: { title, url, summary, model: this.model },
    });
    return response?.questions || [];
  }

  async *summarizePdf({ url, mode }) {
    // For WebLLM, PDF text must be extracted client-side first,
    // then summarized as regular text. The popup handles this.
    throw new Error(
      "PDF summarization via WebLLM should use client-side extraction. " +
      "Call summarize() with the extracted text instead."
    );
  }

  /** Check if the engine is ready. */
  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "status",
    });
    return response;
  }
}

// ─── Local Ollama backend provider ───────────────────────────────────────────
// Direct fetch to the FastAPI backend — same as the original extension behavior.

class LocalProvider {
  constructor(model, apiBase) {
    this.model = model;
    this.apiBase = (apiBase || DEFAULT_LOCAL_API_BASE).replace(/\/+$/, "");
  }

  async *summarize({ title, url, content, mode }) {
    const response = await fetch(`${this.apiBase}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, url, content, mode, model: this.model }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `Request failed: ${response.status}`);
    }

    yield* this._readStream(response);
  }

  async *ask({ title, url, content, question }) {
    const response = await fetch(`${this.apiBase}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, url, content, question, model: this.model }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `Ask request failed: ${response.status}`);
    }

    yield* this._readStream(response);
  }

  async suggestQuestions({ title, url, summary }) {
    const response = await fetch(`${this.apiBase}/suggest-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, url, summary, model: this.model }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `Prompt request failed: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data.questions) ? data.questions.slice(0, 2) : [];
  }

  async *summarizePdf({ url, mode }) {
    const response = await fetch(`${this.apiBase}/pdf/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, mode, model: this.model }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `PDF request failed: ${response.status}`);
    }

    yield* this._readStream(response);
  }

  async checkReady() {
    try {
      const response = await fetch(`${this.apiBase}/health`);
      if (!response.ok) return { ready: false };
      const data = await response.json();
      return { ready: data.connected === true, models: data.models || [] };
    } catch {
      return { ready: false };
    }
  }

  async *_readStream(response) {
    if (!response.body) {
      yield await response.text();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    yield decoder.decode();
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function getProvider(settings) {
  if (settings.provider === PROVIDERS.LOCAL) {
    return new LocalProvider(settings.localModel, settings.localApiBase);
  }
  return new WebLLMProvider(settings.webllmModel);
}
