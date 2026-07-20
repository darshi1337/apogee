// Provider abstraction, routes inference requests to WebLLM (in-browser via offscreen document, Chrome only), Transformers.js (in-browser via WASM, Firefox only), or a local Ollama instance (talked to directly over HTTP).

import { PROVIDERS, DEFAULT_OLLAMA_HOST } from "./constants.js";

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

// Thrown by attachToStream when the job ended because the user cancelled it
// (as opposed to a real failure), so callers can render a neutral "cancelled"
// state instead of an error message and skip persisting the partial result.
export class StreamCancelledError extends Error {}

// Subscribes to the service-worker job for streamId, yielding buffered text
// plus live chunks. Works both right after starting a job and when resuming
// one still in flight (e.g. after the popup was closed and reopened).
export async function* attachToStream(streamId) {
  // We use the `popup-stream-` prefix specifically so that the offscreen document does not receive this port connection directly (preventing duplicate listeners/errors).
  const port = chrome.runtime.connect({ name: `popup-stream-${streamId}` });
  const queue = [];
  let resolvePromise = null;
  let error = null;
  let cancelled = false;
  let done = false;

  port.onMessage.addListener((msg) => {
    if (msg.type === "chunk") {
      queue.push(msg.text);
    } else if (msg.type === "done") {
      done = true;
    } else if (msg.type === "cancelled") {
      cancelled = true;
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
    // A disconnect that arrives *after* a "done"/"error" message is the
    // normal end of a stream (the sender closes the port once finished).
    // A disconnect that arrives before either, e.g. the service worker
    // was evicted mid-stream (MV3 kills it after ~30s of inactivity) or
    // the underlying job crashed without reporting, must NOT be treated
    // as success, or whatever partial text arrived so far gets silently
    // persisted and cached as the "complete" summary/answer.
    if (!done) {
      error = "Connection to the model was lost before the response finished.";
      done = true;
    }
    if (resolvePromise) {
      resolvePromise();
      resolvePromise = null;
    }
  });

  try {
    while (true) {
      // Buffered chunks always drain first, even after cancellation/error,
      // so text that arrived before the terminal message isn't dropped.
      if (queue.length > 0) {
        yield queue.shift();
      } else if (cancelled) {
        throw new StreamCancelledError("Cancelled.");
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

// Fire-and-forget request to stop an in-flight summarize/ask job. The actual
// UI settling happens when the resulting "cancelled" message comes back
// through the attachToStream port above, not from this call's response.
export function cancelStream(streamId) {
  if (!streamId) return;
  chrome.runtime.sendMessage(
    {
      target: "service-worker",
      action: "cancel-stream",
      payload: { streamId },
    },
    () => void chrome.runtime.lastError,
  );
}

// Starts a job on the service worker and attaches to it. The returned
// streamId can be persisted and reattached later via attachToStream.
async function startWebllmStream(action, payload) {
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action,
    payload,
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return { streamId, stream: attachToStream(streamId) };
}

async function startOllamaStream(action, payload) {
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action: "ollama-stream",
    payload: { action, ...payload },
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return { streamId, stream: attachToStream(streamId) };
}

async function startTransformersStream(action, payload) {
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action: "transformers-stream",
    payload: { action, ...payload },
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return { streamId, stream: attachToStream(streamId) };
}

class WebLLMProvider {
  constructor(model) {
    this.model = model;
  }

  /**
   * @returns {Promise<{streamId: string, stream: AsyncGenerator<string>}>}
   */
  summarize({ title, url, content, mode }) {
    return startWebllmStream("summarize", {
      title,
      url,
      content,
      mode,
      model: this.model,
    });
  }

  ask({ title, url, content, question }) {
    return startWebllmStream("ask", {
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

  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "status",
    });
    return response;
  }
}

// In-browser inference via Transformers.js (ONNX/WASM, no WebGPU or Worker
// required). Only available on Firefox (see PROVIDERS in lib/constants.js);
// runs directly in the service worker's background page. See
// background/service-worker.js's "transformers-stream" handler.
class TransformersProvider {
  constructor(model) {
    this.model = model;
  }

  summarize({ title, url, content, mode }) {
    return startTransformersStream("summarize", {
      title,
      url,
      content,
      mode,
      model: this.model,
    });
  }

  ask({ title, url, content, question }) {
    return startTransformersStream("ask", {
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
      action: "transformers-suggest-questions",
      payload: { title, url, summary, model: this.model },
    });
    return response?.questions || [];
  }

  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "transformers-status",
    });
    return response;
  }
}

// Talks to a local Ollama instance directly over HTTP (via the service
// worker, see background/service-worker.js's "ollama-stream" handler), no
// intermediate backend server. PDF text is extracted client-side (see
// popup.js's PDF branch + lib/pdfExtract.js) and fed in through summarize()
// like any other page, so there's no separate summarizePdf() here.
class DirectOllamaProvider {
  constructor(model, host) {
    this.model = model;
    this.host = (host || DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
  }

  summarize({ title, url, content, mode }) {
    return startOllamaStream("summarize", {
      title,
      url,
      content,
      mode,
      model: this.model,
      host: this.host,
    });
  }

  ask({ title, url, content, question }) {
    return startOllamaStream("ask", {
      title,
      url,
      content,
      question,
      model: this.model,
      host: this.host,
    });
  }

  async suggestQuestions({ title, url, summary }) {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "ollama-suggest-questions",
      payload: { title, url, summary, model: this.model, host: this.host },
    });
    return response?.questions || [];
  }

  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "ollama-status",
      payload: { host: this.host },
    });
    return {
      ready: response?.connected === true,
      models: response?.models || [],
    };
  }
}

export function getProvider(settings) {
  if (settings.provider === PROVIDERS.LOCAL) {
    return new DirectOllamaProvider(settings.localModel, settings.ollamaHost);
  }
  // Exactly one in-browser provider exists per build (see PROVIDERS in
  // lib/constants.js): Transformers.js on Firefox, WebLLM on Chrome. Any
  // non-"local" value, including a stale provider id carried over from the
  // other build's profile (e.g. "webllm" stored in a Firefox profile),
  // lands on this build's in-browser provider rather than one that can't
  // run here.
  if (PROVIDERS.TRANSFORMERS) {
    return new TransformersProvider(settings.transformersModel);
  }
  return new WebLLMProvider(settings.webllmModel);
}
