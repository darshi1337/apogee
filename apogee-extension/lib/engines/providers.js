import { UserFacingError } from "../util/userError.js";
import {
  DEFAULT_OLLAMA_PORT,
  validateLoopbackUrl,
} from "../util/ollamaHost.js";
import {
  PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_LLAMACPP_HOST,
  LOCAL_PROVIDER_TYPES,
} from "../constants.js";
import { REMOTE_PROVIDER_IDS } from "./remoteModels.js";
import { hasRemoteGenerationPermissions } from "./remoteCredentials.js";

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
      onStats?.(msg.tokensPerSec, msg.elapsedMs);
    } else if (msg.type === "done") {
      done = true;
      if (msg.tokensPerSec != null || msg.elapsedMs != null) {
        onStats?.(msg.tokensPerSec, msg.elapsedMs);
      }
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

// One starter for every engine: the loopback HTTP engines (Ollama,
// llama.cpp, Transformers) wrap under a fixed service-worker action with
// the job action inside the payload, while WebLLM uses the job action
// itself. Callers pass the already-shaped message.
async function startStream(serviceAction, payload, { onStats } = {}) {
  const { streamId, execution } = await sendToServiceWorker({
    target: "service-worker",
    action: serviceAction,
    payload,
  });
  if (!streamId) {
    throw new Error("No streamId returned from service worker");
  }
  return {
    streamId,
    stream: attachToStream(streamId, { onStats }),
    ...(execution ? { execution } : {}),
  };
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
    focusKeyword,
    onStats,
  }) {
    return startStream(
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
        focusKeyword,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startStream(
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
    focusKeyword,
    onStats,
  }) {
    return startStream(
      "transformers-stream",
      {
        action: "summarize",
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
        focusKeyword,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startStream(
      "transformers-stream",
      {
        action: "ask",
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
    // Defense in depth: the service worker re-validates and overwrites this
    // host before any fetch, but never persist or send a value the shared
    // validator would reject.
    try {
      this.host = validateLoopbackUrl(host || DEFAULT_OLLAMA_HOST, {
        label: "Ollama",
        defaultPort: DEFAULT_OLLAMA_PORT,
      });
    } catch {
      this.host = DEFAULT_OLLAMA_HOST;
    }
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
    focusKeyword,
    onStats,
  }) {
    return startStream(
      "ollama-stream",
      {
        action: "summarize",
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
        focusKeyword,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startStream(
      "ollama-stream",
      {
        action: "ask",
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
    // Same shared validator as the Ollama provider above, with the llama.cpp
    // default port derived from DEFAULT_LLAMACPP_HOST.
    let llamaDefaultPort = "8080";
    try {
      llamaDefaultPort = new URL(DEFAULT_LLAMACPP_HOST).port || "8080";
    } catch {
      // Keep the built-in fallback above.
    }
    try {
      this.host = validateLoopbackUrl(host || DEFAULT_LLAMACPP_HOST, {
        label: "llama.cpp",
        defaultPort: llamaDefaultPort,
      });
    } catch {
      this.host = DEFAULT_LLAMACPP_HOST;
    }
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
    focusKeyword,
    onStats,
  }) {
    return startStream(
      "llamacpp-stream",
      {
        action: "summarize",
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
        focusKeyword,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, language, translationEngine, onStats }) {
    return startStream(
      "llamacpp-stream",
      {
        action: "ask",
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

export function isRemoteProvider(type) {
  return REMOTE_PROVIDER_IDS.includes(type);
}

class RemoteProvider {
  constructor(provider, model) {
    this.provider = provider;
    this.model = model;
  }

  summarize({
    title,
    url,
    content,
    mode,
    type,
    finalize,
    isSelection,
    focusKeyword,
    onStats,
  }) {
    const metadata =
      finalize &&
      Object.fromEntries(
        [
          "customContent",
          "isSelection",
          "pageType",
          "selectionText",
          "jobId",
          "tabId",
          "windowId",
          "notifyOnFinish",
          "persistUrl",
        ]
          .filter((key) => Object.hasOwn(finalize, key))
          .map((key) => [key, finalize[key]]),
      );
    return startStream(
      "remote-stream",
      {
        action: "summarize",
        title,
        url,
        content,
        mode,
        type,
        finalize: metadata,
        isSelection,
        focusKeyword,
      },
      { onStats },
    );
  }

  ask({ title, url, content, question, onStats }) {
    return startStream(
      "remote-stream",
      {
        action: "ask",
        title,
        url,
        content,
        question,
      },
      { onStats },
    );
  }

  async checkReady() {
    const response = await sendToServiceWorker({
      target: "service-worker",
      action: "remote-settings-get",
    });
    const state = response?.providers?.[this.provider];
    let permitted = false;
    try {
      permitted = await hasRemoteGenerationPermissions();
    } catch {
      // Missing permission APIs must not claim the remote engine is ready.
    }
    return {
      ready:
        permitted &&
        state?.consent === true &&
        state?.generationConsent === true &&
        state?.hasApiKey === true &&
        state?.catalog?.stale === false &&
        !!state?.model &&
        state.catalog.models?.some((entry) => entry.id === state.model) ===
          true,
    };
  }
}

export function getProviderType(settings) {
  const provider = settings.provider;
  if (Object.values(PROVIDERS).includes(provider)) return provider;
  return DEFAULT_PROVIDER;
}

export function getModelForSettings(settings) {
  if (isRemoteProvider(settings.provider))
    return settings[`${settings.provider}Model`];
  if (settings.provider === PROVIDERS.LOCAL) return settings.localModel;
  if (settings.provider === PROVIDERS.LLAMACPP) return settings.llamaModel;
  if (settings.provider === PROVIDERS.TRANSFORMERS) {
    return settings.transformersModel;
  }
  return settings.webllmModel;
}

export function getProvider(settings) {
  const type = getProviderType(settings);
  return getProviderForType(type, settings);
}

export function getProviderForType(type, settings) {
  if (isRemoteProvider(type)) {
    return new RemoteProvider(
      type,
      getModelForSettings({ ...settings, provider: type }),
    );
  }
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
  if (PROVIDERS.WEBLLM && type === PROVIDERS.WEBLLM) {
    return new WebLLMProvider(settings.webllmModel);
  }
  return new WebLLMProvider(settings.webllmModel);
}

// Ordered engine fallback chain for a job (#415). The preferred engine
// comes first; fallback entries whose credentials are missing are skipped
// so a job never spends a round-trip on an engine that cannot authenticate.
export function providerNeedsKey(type, settings) {
  if (type === PROVIDERS.LLAMACPP) {
    return !settings?.llamaApiKey;
  }
  return false;
}

export function resolveEngineChain(settings, chain) {
  const preferred = getProviderType(settings);
  const ordered =
    Array.isArray(chain) && chain.length > 0
      ? chain
      : [preferred, ...LOCAL_PROVIDER_TYPES.filter((t) => t !== preferred)];
  const seen = new Set();
  const result = [];
  for (const type of ordered) {
    if (!LOCAL_PROVIDER_TYPES.includes(type) || seen.has(type)) continue;
    seen.add(type);
    // The first entry is the caller's explicit choice, so it is always
    // tried. Key-skipping applies to fallbacks only: without it the
    // preferred engine itself could be dropped before a single attempt.
    if (result.length > 0 && providerNeedsKey(type, settings)) continue;
    result.push(type);
  }
  return result;
}

export function buildExtractedTextFallback(content, maxChars = 4000) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

// Try each engine in order with runFn(type, provider, index). runFn must
// cover the whole job attempt (start + consume): several engines only
// report failure mid-stream, after the start handshake already succeeded,
// so wrapping the start call alone would never retry them. Returns the
// first success; when every engine fails, resolves with the extracted-text
// fallback so the run still ends with page content instead of nothing.
// opts.buildProvider(type) overrides provider construction (tests).
export async function runWithEngineFallback(settings, chain, runFn, opts = {}) {
  if (isRemoteProvider(settings.provider)) {
    if (settings.autoEngine) {
      throw new UserFacingError(
        "Choose a local engine to use automatic engine selection.",
      );
    }
    const type = settings.provider;
    try {
      const provider = opts.buildProvider
        ? await opts.buildProvider(type)
        : getProviderForType(type, settings);
      return { type, result: await runFn(type, provider, 0), errors: [] };
    } catch (err) {
      if (err instanceof StreamCancelledError) throw err;
      throw new UserFacingError(
        "Remote generation failed. Check remote settings and try again.",
      );
    }
  }
  const types = resolveEngineChain(settings, chain);
  const errors = [];
  const build =
    opts.buildProvider ??
    ((type) => getProviderForType(type, { ...settings, provider: type }));
  for (const [index, type] of types.entries()) {
    try {
      const result = await runFn(type, await build(type), index);
      return { type, result, errors };
    } catch (err) {
      if (err instanceof StreamCancelledError) throw err;
      errors.push({ type, error: err });
    }
  }
  return {
    type: "extracted-text",
    result: { fallbackText: buildExtractedTextFallback(opts.content) },
    errors,
  };
}
