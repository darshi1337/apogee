// Shared Transformers.js (ONNX/WASM) text-generation engine plumbing, used
// only on Firefox as its in-browser provider (see PROVIDERS in
// lib/constants.js). Runs directly in background/service-worker.js
// (Firefox's background page, which, unlike Chrome's real service worker, has
// a window/DOM context and can dynamic-import it) because, unlike wllama,
// @huggingface/transformers's WASM backend never spawns a dedicated Worker
// (onnxruntime-web's own env.wasm.proxy is hardcoded false by the library),
// so it isn't affected by the blob:-URL-worker CSP restriction that blocks
// wllama in every extension execution context on both browsers.

import { TRANSFORMERS_MODELS } from "./constants.js";

// onnxruntime-web's own WASM runtime (not the LLM weights) is a ~23 MB
// "universal" binary with no smaller non-threaded build available, so it's
// fetched from jsDelivr at runtime rather than bundled locally, the same
// tradeoff lib/embeddings.js already makes for its embedding pipeline. MUST
// match the exact onnxruntime-web version @huggingface/transformers resolves
// to (see embeddings.js's own copy of this constant/comment) or the JS glue
// and WASM binary go out of sync and fail to load.
const ONNXRUNTIME_WEB_VERSION = "1.26.0-dev.20260416-b7804b056c";

const GENERATION_MAX_TOKENS = 2048;

let engine = null;
let currentModelId = null;
let loadingModelId = null;
let lock = Promise.resolve();

async function acquireLock() {
  let release;
  const nextLock = new Promise((resolve) => {
    release = resolve;
  });
  const currentLock = lock;
  lock = nextLock;
  await currentLock;
  return release;
}

let _transformers = null;
async function getTransformers() {
  if (!_transformers) {
    _transformers = await import("@huggingface/transformers");
  }
  return _transformers;
}

async function ensureEngine(modelId, onProgress) {
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine) {
    try {
      await engine.dispose();
    } catch {
      // ignore
    }
    engine = null;
    currentModelId = null;
  }

  const modelInfo = TRANSFORMERS_MODELS.find((m) => m.id === modelId);
  if (!modelInfo) {
    throw new Error(`Unknown Transformers.js model: ${modelId}`);
  }

  loadingModelId = modelId;

  const { pipeline, env } = await getTransformers();
  // Extension pages aren't cross-origin-isolated, so multi-threaded WASM
  // (which needs SharedArrayBuffer) isn't available anyway; forcing
  // single-threaded up front skips onnxruntime-web's feature probe, same as
  // lib/embeddings.js.
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = {
    wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_VERSION}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
  };

  engine = await pipeline("text-generation", modelInfo.id, {
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

  currentModelId = modelId;
  loadingModelId = null;
  return engine;
}

// ensureEngine's fast path trusts currentModelId and hands back the cached
// engine without checking it's still healthy; any caller that touches the
// engine must go through withEngine so a failure forces a full reload next
// time (mirrors offscreen.js's WebLLM resetEngineState/withEngine).
// Disposes the old engine before dropping the reference: without that, an
// errored engine's WASM heap (hundreds of MB of model weights) stayed
// allocated for the life of the background page while a replacement engine
// loaded alongside it. Fire-and-forget so a failing dispose can't mask the
// error that got us here.
function resetEngineState() {
  if (engine) {
    const stale = engine;
    try {
      Promise.resolve(stale.dispose()).catch(() => {});
    } catch {
      // ignore
    }
  }
  engine = null;
  currentModelId = null;
  loadingModelId = null;
}

export async function withTransformersEngine(modelId, onProgress, fn) {
  const release = await acquireLock();
  try {
    const eng = await ensureEngine(modelId, onProgress);
    return await fn(eng);
  } catch (err) {
    resetEngineState();
    throw err;
  } finally {
    release();
  }
}

export function getTransformersStatus() {
  return { currentModelId, loadingModelId };
}

// Bridges TextStreamer's callback-based streaming into an async generator,
// the same queue/wake pattern lib/providers.js's attachToStream uses to
// bridge port messages into an async generator. Takes a plain prompt string
// (wrapped into a single-turn chat message here) to match the chatStreamFn
// seam summarizeText (lib/ollamaSummarize.js) expects.
export async function* transformersChatStream(eng, prompt) {
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

  const streamer = new TextStreamer(eng.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      if (text) queue.push(text);
      wake();
    },
  });

  eng([{ role: "user", content: prompt }], {
    max_new_tokens: GENERATION_MAX_TOKENS,
    do_sample: false,
    streamer,
  })
    .catch((err) => {
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

export async function transformersGenerateText(eng, prompt, maxTokens = 512) {
  const output = await eng([{ role: "user", content: prompt }], {
    max_new_tokens: maxTokens,
    do_sample: false,
  });
  return output[0]?.generated_text?.at(-1)?.content || "";
}
