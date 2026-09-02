import { UserFacingError } from "../util/userError.js";
import {
  PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_LLAMACPP_HOST,
} from "../constants.js";

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

export class StreamCancelledError extends Error {}

export async function* attachToStream(streamId, { onStats } = {}) {
  const port = chrome.runtime.connect({ name: `popup-stream-${streamId}` });
  const queue = [];
  let resolvePromise = null;
  let error = null;
  let errorUserFacing = false;
  let cancelled = false;
  let done = false;

  port.onMessage.addListener((msg) => {
    if (msg.type === "chunk") {
      queue.push(msg.text);
    } else if (msg.type === "stats") {
      onStats?.(msg.tokensPerSec);
    } else if (msg.type === "done") {
      done = true;
      if (msg.tokensPerSec != null) onStats?.(msg.tokensPerSec);
    } else if (msg.type === "cancelled") {
      cancelled = true;
      done = true;
    } else if (msg.type === "error") {
      error = msg.error || "Unknown error during streaming";
      errorUserFacing = !!msg.userFacing;
      done = true;
    }
    if (resolvePromise) {
      resolvePromise();
      resolvePromise = null;
    }
  });

  port.onDisconnect.addListener(() => {
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
      if (queue.length > 0) {
        yield queue.shift();
      } else if (cancelled) {
        throw new StreamCancelledError("Cancelled.");
      } else if (error) {
        throw errorUserFacing ? new UserFacingError(error) : new Error(error);
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

async function startWebllmStream(action, payload, { onStats } = {}) {
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action,
    payload,
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return { streamId, stream: attachToStream(streamId, { onStats }) };
}

async function startOllamaStream(action, payload, { onStats } = {}) {
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action: "ollama-stream",
    payload: { action, ...payload },
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return { streamId, stream: attachToStream(streamId, { onStats }) };
}

async function startTransformersStream(action, payload, { onStats } = {}) {
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action: "transformers-stream",
    payload: { action, ...payload },
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return { streamId, stream: attachToStream(streamId, { onStats }) };
}

async function startLlamaCppStream(action, payload, { onStats } = {}) {
  const { streamId } = await sendToServiceWorker({
    target: "service-worker",
    action: "llamacpp-stream",
    payload: { action, ...payload },
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return { streamId, stream: attachToStream(streamId, { onStats }) };
}

class WebLLMProvider {
  constructor(model) {
    this.model = model;
  }

  summarize({
    title,
    url,
    content,
    mode,
    type,
    finalize,
    language,
    translationEngine,
    isSelection,
    onStats,
  }) {
    return startWebllmStream(
      "summarize",
      {
        title,
        url,
        content,
        mode,
        type,
        model: this.model,
        finalize,
        language,
        translationEngine,
        isSelection,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startWebllmStream(
      "ask",
      {
        title,
        url,
        content,
        question,
        model: this.model,
        language,
        translationEngine,
      },
      { onStats },
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

class TransformersProvider {
  constructor(model) {
    this.model = model;
  }

  summarize({
    title,
    url,
    content,
    mode,
    type,
    finalize,
    language,
    translationEngine,
    isSelection,
    onStats,
  }) {
    return startTransformersStream(
      "summarize",
      {
        title,
        url,
        content,
        mode,
        type,
        model: this.model,
        finalize,
        language,
        translationEngine,
        isSelection,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startTransformersStream(
      "ask",
      {
        title,
        url,
        content,
        question,
        model: this.model,
        language,
        translationEngine,
      },
      { onStats },
    );
  }

  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "transformers-status",
    });
    return response;
  }
}

class DirectOllamaProvider {
  constructor(model, host) {
    this.model = model;
    this.host = (host || DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
  }

  summarize({
    title,
    url,
    content,
    mode,
    type,
    finalize,
    language,
    translationEngine,
    isSelection,
    onStats,
  }) {
    return startOllamaStream(
      "summarize",
      {
        title,
        url,
        content,
        mode,
        type,
        model: this.model,
        host: this.host,
        finalize,
        language,
        translationEngine,
        isSelection,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startOllamaStream(
      "ask",
      {
        title,
        url,
        content,
        question,
        model: this.model,
        host: this.host,
        language,
        translationEngine,
      },
      { onStats },
    );
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
      error: response?.error,
    };
  }
}

class DirectLlamaCppProvider {
  constructor(model, host, apiKey) {
    this.model = model;
    this.host = (host || DEFAULT_LLAMACPP_HOST).replace(/\/+$/, "");
    this.apiKey = apiKey || "";
  }

  summarize({
    title,
    url,
    content,
    mode,
    type,
    finalize,
    language,
    translationEngine,
    isSelection,
    onStats,
  }) {
    return startLlamaCppStream(
      "summarize",
      {
        title,
        url,
        content,
        mode,
        type,
        model: this.model,
        host: this.host,
        apiKey: this.apiKey,
        finalize,
        language,
        translationEngine,
        isSelection,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startLlamaCppStream(
      "ask",
      {
        title,
        url,
        content,
        question,
        model: this.model,
        host: this.host,
        apiKey: this.apiKey,
        language,
        translationEngine,
      },
      { onStats },
    );
  }

  // `contextTokens` rides along because llama-server reports the window it is actually running, which no model name can imply. Null means it did not say, not that it is unlimited.
  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "llamacpp-status",
      payload: { host: this.host, apiKey: this.apiKey },
    });
    return {
      ready: response?.connected === true,
      models: response?.models || [],
      contextTokens: response?.contextTokens ?? null,
      error: response?.error,
    };
  }
}

export function getProviderType(settings) {
  const provider = settings.provider;
  if (Object.values(PROVIDERS).includes(provider)) return provider;
  return DEFAULT_PROVIDER;
}

export function getModelForSettings(settings) {
  if (settings.provider === PROVIDERS.LOCAL) return settings.localModel;
  if (settings.provider === PROVIDERS.LLAMACPP) return settings.llamaModel;
  if (settings.provider === PROVIDERS.TRANSFORMERS) {
    return settings.transformersModel;
  }
  return settings.webllmModel;
}

export function getProvider(settings) {
  const type = getProviderType(settings);
  if (type === PROVIDERS.LOCAL) {
    return new DirectOllamaProvider(settings.localModel, settings.ollamaHost);
  }
  if (type === PROVIDERS.LLAMACPP) {
    return new DirectLlamaCppProvider(
      settings.llamaModel,
      settings.llamaHost,
      settings.llamaApiKey,
    );
  }
  if (type === PROVIDERS.TRANSFORMERS) {
    return new TransformersProvider(settings.transformersModel);
  }
  return new WebLLMProvider(settings.webllmModel);
}
