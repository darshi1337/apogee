// Local text-embedding pipeline used for retrieval-augmented "Ask" answers
// (see lib/rag.js). Runs a small quantized sentence-embedding model via
// @huggingface/transformers (WASM/onnxruntime-web) entirely on-device, no
// network calls beyond fetching the public model weights once (same trust
// tier as WebLLM's own model downloads, already allowed by manifest CSP).
//
// Only ever loaded from offscreen.js (directly, or via the direct-Ollama
// "ask" relay in background/service-worker.js, see getRelevantAskContent
// there): dynamic import() support inside a ServiceWorkerGlobalScope has
// been unreliable in Chrome MV3 (long rejected per spec, and Vite's preload
// helper additionally assumed a `window`, see vite.config.js's modulePreload
// note), so the offscreen document, a real Document context, is the
// verified-working home for this pipeline.
// The dynamic import here mirrors offscreen.js's getWebLLM(): keeps this
// ~9 MB dependency out of the importing module's initial bundle/eviction
// path (offscreen.js registers its message handlers before either loads).

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// onnxruntime-web's own WASM runtime (not the embedding model above) is a
// single ~23 MB "universal" binary in every current release, there's no
// smaller non-threaded build anymore. Rather than let Vite bundle that into
// the shipped extension package, it's fetched from jsDelivr at runtime, the
// same tradeoff already made for WebLLM/embedding model weights.
//
// MUST match the exact onnxruntime-web version @huggingface/transformers
// resolves to (see node_modules/onnxruntime-web/package.json) or the JS
// glue and WASM binary go out of sync and fail to load. Our package.json
// pins @huggingface/transformers to an exact version specifically so this
// doesn't drift silently; re-check both when upgrading either.
const ONNXRUNTIME_WEB_VERSION = "1.26.0-dev.20260416-b7804b056c";

let _transformers = null;
async function getTransformers() {
  if (!_transformers) {
    _transformers = await import("@huggingface/transformers");
  }
  return _transformers;
}

let _extractorPromise = null;
async function getExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline, env } = await getTransformers();
      // Extensions pages aren't cross-origin-isolated, so multi-threaded WASM
      // (which needs SharedArrayBuffer) isn't available anyway; forcing
      // single-threaded up front skips onnxruntime-web's feature probe. The
      // model is tiny enough that the throughput cost doesn't matter here.
      env.backends.onnx.wasm.numThreads = 1;
      // Only the .wasm binary comes from jsDelivr (fetched via plain
      // fetch()+WebAssembly.instantiate, governed by the manifest's
      // connect-src). Deliberately NOT setting `.mjs` here: onnxruntime-web's
      // small JS glue is left to resolve from its normal local/bundled
      // path, which stays same-origin. Overriding `.mjs` too (or passing
      // wasmPaths as a single base-URL string, which implicitly overrides
      // both) makes it dynamically `import()` that glue from jsDelivr
      // instead, which the manifest's script-src ('self' only, deliberately
      // not relaxed to allow remote script execution) then blocks.
      env.backends.onnx.wasm.wasmPaths = {
        wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_VERSION}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
      };
      return pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
        device: "wasm",
      });
    })();
  }
  return _extractorPromise;
}

/**
 * Embeds a batch of strings, returning one normalized vector (plain number
 * array) per input, in the same order. Mean-pooled + L2-normalized, so
 * cosine similarity between two results reduces to a plain dot product
 * (see dot() below).
 */
export async function embedTexts(texts) {
  if (!texts || texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
