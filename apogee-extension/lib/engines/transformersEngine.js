import { debugLog } from "../util/log.js";
import {
  TRANSFORMERS_MODELS,
  EXPERIMENTAL_WASM_THREADS,
} from "../constants.js";
import { getTransformers } from "./transformersLib.js";
import { ortWasmUrl, ortWasmBinary } from "./onnxWasm.js";
import { createLock } from "../util/mutex.js";

export const ENGINE_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const LOAD_MAX_ATTEMPTS = 3;

export function isTransientLoadError(err) {
  return /cache\.add|network\s?error|failed to fetch|fetch failed|terminated|timeout|econn|enotfound|socket|stall/i.test(
    err?.message || "",
  );
}

export function isEngineCorruptingError(err) {
  return /out of memory|\boom\b|buffer allocation|gpubuffer|allocation failed|memory limit|disposed|destroyed|context (was )?lost|wasm.*(abort|trap|\boom\b)/i.test(
    err?.message || "",
  );
}

const GENERATION_MAX_TOKENS = 640;

let engine = null;
let currentModelId = null;
let loadingModelId = null;

function resolveWasmThreads(label) {
  const isolated = globalThis.crossOriginIsolated === true;
  const hasSAB = typeof SharedArrayBuffer !== "undefined";
  const cores = globalThis.navigator?.hardwareConcurrency || 1;
  const threads =
    EXPERIMENTAL_WASM_THREADS && isolated && hasSAB ? Math.min(cores, 4) : 1;
  debugLog(
    `[mt] ${label}: crossOriginIsolated=${isolated} ` +
      `SharedArrayBuffer=${hasSAB} cores=${cores} ` +
      `flag=${EXPERIMENTAL_WASM_THREADS} -> numThreads=${threads}`,
  );
  return threads;
}

const acquireLock = createLock();

async function loadPipeline(modelId, modelInfo, onProgress) {
  const { pipeline, env } = await getTransformers();
  debugLog("[transformers] library loaded, preparing WASM backend");
  env.backends.onnx.wasm.numThreads = resolveWasmThreads("text-gen");
  env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl() };
  env.backends.onnx.wasm.wasmBinary = await ortWasmBinary();
  debugLog("[transformers] WASM binary ready, building pipeline");

  for (let attempt = 1; ; attempt++) {
    try {
      return await pipeline("text-generation", modelInfo.id, {
        dtype: modelInfo.dtype,
        device: "wasm",
        progress_callback: (p) => {
          if (p.status !== "progress") return;
          onProgress?.({
            progress: p.progress / 100,
            text: `Downloading model... ${Math.round(p.progress)}%`,
          });
        },
      });
    } catch (err) {
      debugLog(
        `[transformers] load attempt ${attempt} failed: ${err?.message}`,
      );
      if (!isTransientLoadError(err) || attempt >= LOAD_MAX_ATTEMPTS) throw err;
      onProgress?.({
        progress: 0,
        text: `Download hiccup - retrying (attempt ${attempt + 1} of ${LOAD_MAX_ATTEMPTS})...`,
      });
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function ensureEngine(modelId, onProgress) {
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine) {
    try {
      await engine.dispose();
    } catch {
      // Safe fallback: ignore disposal errors when replacing an existing engine
    }
    engine = null;
    currentModelId = null;
  }

  const modelInfo = TRANSFORMERS_MODELS.find((m) => m.id === modelId);
  if (!modelInfo) {
    throw new Error(`Unknown Transformers.js model: ${modelId}`);
  }

  loadingModelId = modelId;

  debugLog(`[transformers] ensureEngine: loading ${modelId}`);
  try {
    engine = await loadPipeline(modelId, modelInfo, onProgress);
  } catch (err) {
    // Load failed: do not leave a stale loading flag behind.
    engine = null;
    currentModelId = null;
    loadingModelId = null;
    throw err;
  }
  debugLog(`[transformers] pipeline ready for ${modelId}`);

  currentModelId = modelId;
  loadingModelId = null;
  return engine;
}

function resetEngineState() {
  if (engine) {
    const stale = engine;
    try {
      Promise.resolve(stale.dispose()).catch(() => {});
    } catch {
      // Safe fallback: best-effort cleanup of stale model engine
    }
  }
  engine = null;
  currentModelId = null;
  loadingModelId = null;
}

export async function withTransformersEngine(
  modelId,
  onProgress,
  fn,
  options = {},
) {
  const release = await acquireLock({
    timeout: options.lockTimeout ?? ENGINE_LOCK_TIMEOUT_MS,
    signal: options.signal,
  });
  try {
    // Load failures clean up in ensureEngine; never touch a healthy engine
    // for them. A lock timeout/abort throws above, before we hold anything.
    const eng = await ensureEngine(modelId, onProgress);
    try {
      return await fn(eng);
    } catch (err) {
      // A transient inference failure must not discard a healthy multi-GB
      // engine. Only drop it when the error shows the engine itself is
      // corrupted (OOM / WASM abort) — otherwise the next stream would pay a
      // full reload for no reason.
      if (isEngineCorruptingError(err)) {
        resetEngineState();
      }
      throw err;
    }
  } finally {
    release();
  }
}

export function getTransformersStatus() {
  return { currentModelId, loadingModelId };
}

let translator = null;
let translatorModelId = null;
const acquireTranslatorLock = createLock();

export const TRANSLATOR_IDLE_MS = 60 * 1000;
let translatorIdleTimer = null;

function cancelTranslatorIdleDispose() {
  if (translatorIdleTimer) {
    clearTimeout(translatorIdleTimer);
    translatorIdleTimer = null;
  }
}

function scheduleTranslatorIdleDispose() {
  cancelTranslatorIdleDispose();
  translatorIdleTimer = setTimeout(() => {
    translatorIdleTimer = null;
    disposeTranslatorNow();
  }, TRANSLATOR_IDLE_MS);
  if (translatorIdleTimer.unref) translatorIdleTimer.unref();
}

/** Dispose the cached translator so it stops contending WASM memory. */
export function disposeTranslatorNow() {
  cancelTranslatorIdleDispose();
  if (translator) {
    const stale = translator;
    translator = null;
    translatorModelId = null;
    try {
      Promise.resolve(stale.dispose()).catch(() => {});
    } catch {
      // Safe fallback: best-effort cleanup of idle translator
    }
    return true;
  }
  translatorModelId = null;
  return false;
}

export function getTranslatorStatus() {
  return {
    currentModelId: translatorModelId,
    idleDisposeScheduled: translatorIdleTimer !== null,
  };
}

export function __setTranslatorForTest(t, modelId) {
  cancelTranslatorIdleDispose();
  translator = t;
  translatorModelId = modelId;
}

async function ensureTranslator(modelId, onProgress) {
  if (translator && translatorModelId === modelId) return translator;
  if (translator) {
    try {
      await translator.dispose();
    } catch {
      // Safe fallback: ignore disposal errors when replacing translator engine
    }
    translator = null;
    translatorModelId = null;
  }
  const { pipeline, env } = await getTransformers();
  env.backends.onnx.wasm.numThreads = resolveWasmThreads("translator");
  env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl() };
  env.backends.onnx.wasm.wasmBinary = await ortWasmBinary();
  translator = await pipeline("translation", modelId, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status !== "progress") return;
      onProgress?.({
        progress: p.progress / 100,
        text: `Downloading translation model... ${Math.round(p.progress)}%`,
      });
    },
  });
  translatorModelId = modelId;
  return translator;
}

export async function withTranslator(modelId, onProgress, fn, options = {}) {
  const release = await acquireTranslatorLock({
    timeout: options.lockTimeout ?? ENGINE_LOCK_TIMEOUT_MS,
    signal: options.signal,
  });
  cancelTranslatorIdleDispose();
  try {
    let t;
    try {
      t = await ensureTranslator(modelId, onProgress);
    } catch (err) {
      if (translator) {
        try {
          Promise.resolve(translator.dispose()).catch(() => {});
        } catch {
          // Safe fallback: best-effort cleanup of failed translator
        }
      }
      translator = null;
      translatorModelId = null;
      throw err;
    }
    try {
      return await fn(t);
    } catch (err) {
      // Same rule as the text engine: transient translation failures keep the
      // cached translator; only corrupting errors drop it.
      if (isEngineCorruptingError(err)) {
        try {
          Promise.resolve(translator.dispose()).catch(() => {});
        } catch {
          // Safe fallback: best-effort cleanup of failed translator
        }
        translator = null;
        translatorModelId = null;
      }
      throw err;
    } finally {
      // Free WASM memory when the translator goes idle instead of holding it
      // for the life of the page: summarize + translate otherwise contend.
      if (translator) scheduleTranslatorIdleDispose();
    }
  } finally {
    release();
  }
}

const TRANSLATE_MAX_NEW_TOKENS = 256;

export async function translateBatch(t, texts, token = "") {
  if (!texts.length) return [];
  const output = await t(
    texts.map((x) => token + x),
    {
      max_new_tokens: TRANSLATE_MAX_NEW_TOKENS,
      num_beams: 1,
      do_sample: false,
    },
  );
  const arr = Array.isArray(output) ? output : [output];
  return arr.map((o) => o?.translation_text ?? "");
}

export async function* transformersChatStream(eng, prompt, { system } = {}) {
  const { TextStreamer } = await getTransformers();
  const queue = [];
  let resolveNext = null;
  let done = false;
  let streamError = null;

  function wake() {
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  }

  let firstToken = true;
  const streamer = new TextStreamer(eng.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      if (firstToken) {
        debugLog("[transformers] first token emitted");
        firstToken = false;
      }
      if (text) queue.push(text);
      wake();
    },
  });

  debugLog(`[transformers] generation start (prompt ${prompt.length} chars)`);
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];
  eng(messages, {
    max_new_tokens: GENERATION_MAX_TOKENS,
    do_sample: false,
    streamer,
  })
    .then(() => {
      debugLog("[transformers] generation resolved");
    })
    .catch((err) => {
      console.error("[transformers] generation error:", err);
      streamError = err;
    })
    .finally(() => {
      done = true;
      wake();
    });

  while (true) {
    if (queue.length > 0) {
      yield queue.shift();
    } else if (streamError) {
      throw streamError;
    } else if (done) {
      break;
    } else {
      await new Promise((resolve) => {
        resolveNext = resolve;
      });
    }
  }
}
