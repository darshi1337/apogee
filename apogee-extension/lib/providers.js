// Provider abstraction — routes inference requests to either WebLLM (in-browser via offscreen document) or Local Ollama backend.

import { PROVIDERS, DEFAULT_LOCAL_API_BASE } from "./constants.js";

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

  // Poll for streamed chunks via a port-based connection.
  // We use the `popup-stream-` prefix specifically so that the offscreen document does not receive this port connection directly (preventing duplicate listeners/errors).
  const port = chrome.runtime.connect({ name: `popup-stream-${streamId}` });
  const queue = [];
  let resolvePromise = null;
  let error = null;
  let done = false;

  port.onMessage.addListener((msg) => {
    if (msg.type === "chunk") {
      queue.push(msg.text);
    } else if (msg.type === "done") {
      done = true;
    } else if (msg.type === "error") {
      error = msg.error || "Unknown error during streaming";
      done = true;
    }
    if (resolvePromise) {
      resolvePromise();
      resolvePromise = null;
    }
  });

  port.onDisconnect.addListener(() => {
    done = true;
    if (resolvePromise) {
      resolvePromise();
      resolvePromise = null;
    }
  });

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift();
      } else if (error) {
        throw new Error(error);
      } else if (done) {
        break;
      } else {
        await new Promise((resolve) => {
          resolvePromise = resolve;
        });
      }
    }
  } finally {
    port.disconnect();
  }
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
    throw new Error(
      "PDF summarization via WebLLM should use client-side extraction. " +
        "Call summarize() with the extracted text instead.",
    );
  }

  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "status",
    });
    return response;
  }
}

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
      body: JSON.stringify({
        title,
        url,
        content,
        question,
        model: this.model,
      }),
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

export function getProvider(settings) {
  const isFirefox = process.env.TARGET_BROWSER === "firefox";
  if (isFirefox || settings.provider === PROVIDERS.LOCAL) {
    return new LocalProvider(settings.localModel, settings.localApiBase);
  }
  return new WebLLMProvider(settings.webllmModel);
}
