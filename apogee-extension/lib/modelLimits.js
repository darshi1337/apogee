// Approximate per-model context-window budgets, used to size summarization
// chunks (see lib/chunk.js) so capable models aren't forced through the same
// small fixed chunk size as this extension's tiny WebLLM models. Used only
// by lib/ollamaSummarize.js's summarizeText.

import { TRANSFORMERS_MODELS } from "./constants.js";

// All four WebLLM models ship with the same MLC-configured context window
// (verified directly in node_modules/@mlc-ai/web-llm's prebuiltAppConfig,
// each of these exact model IDs has `overrides.context_window_size: 4096`,
// regardless of what the underlying base model is otherwise rated for) —
// there's no per-model variance to account for on this path. MLC's own
// model IDs always end in "-MLC", used below to detect this path without
// threading an extra provider flag through both callers.
const WEBLLM_CONTEXT_TOKENS = 4096;

// Transformers.js models (Firefox's in-browser provider) run single-threaded
// WASM (no SharedArrayBuffer/cross-origin isolation in an extension page), so
// — same reasoning as WebLLM above — the usable budget is deliberately
// capped well below what these models are natively rated for, to keep
// generation latency reasonable on CPU.
const TRANSFORMERS_CONTEXT_TOKENS = 4096;

// Local Ollama models vary widely and, since the live model list (see
// popup.js's updateLocalModelList) now lets users pick any model they've
// pulled rather than one of 4 hardcoded ones, this needs to cover arbitrary
// tags. Matched by prefix so any locally-pulled variant of a known family
// (e.g. "llama3.1:70b-instruct-q4_0") still gets the right budget. Order
// matters: longer/more-specific prefixes are listed before their shorter
// family root (e.g. "qwen2.5" before "qwen2" before "qwen").
const OLLAMA_CONTEXT_TOKENS = [
  { prefix: "llama3.2", tokens: 128000 },
  { prefix: "llama3.1", tokens: 128000 },
  { prefix: "llama3", tokens: 8192 },
  { prefix: "llama2", tokens: 4096 },
  { prefix: "mistral-nemo", tokens: 128000 },
  { prefix: "mixtral", tokens: 32768 },
  { prefix: "mistral", tokens: 8192 },
  { prefix: "qwen2.5", tokens: 32768 },
  { prefix: "qwen2", tokens: 32768 },
  { prefix: "qwen3", tokens: 32768 },
  { prefix: "qwen", tokens: 8192 },
  { prefix: "gemma3", tokens: 128000 },
  { prefix: "gemma2", tokens: 8192 },
  { prefix: "gemma", tokens: 8192 },
  { prefix: "phi3.5", tokens: 128000 },
  { prefix: "phi3", tokens: 128000 },
  { prefix: "deepseek-coder", tokens: 16384 },
  { prefix: "codellama", tokens: 16384 },
];

// Conservative fallback for an unrecognized or custom-built Ollama tag.
const DEFAULT_OLLAMA_CONTEXT_TOKENS = 8192;

// Even on a 128k-context model, local/CPU-bound Ollama inference over that
// much input is slow and memory-hungry; cap the *usable* budget well below
// a model's rated maximum regardless of family, rather than assume a bigger
// context window is free to fully exploit on typical local hardware.
const PRACTICAL_MAX_TOKENS = 24000;

// Reserve room in the context window for the prompt template/instructions
// and the model's own generated output, not just the input chunk.
const RESERVED_TOKENS = 2048;

// Rough chars-per-token for English text. Not exact, just enough to turn a
// token budget into a chunkText() character budget.
const CHARS_PER_TOKEN = 4;

// Transformers.js model IDs are Hugging Face repo names (e.g.
// "HuggingFaceTB/SmolLM2-360M-Instruct"), no distinguishing suffix like
// WebLLM's "-MLC" convention, so they need an explicit membership check
// against the catalog rather than suffix-sniffing.
function isTransformersModel(model) {
  return TRANSFORMERS_MODELS.some((m) => m.id === model);
}

function getOllamaContextTokens(model) {
  const lower = (model || "").toLowerCase();
  const match = OLLAMA_CONTEXT_TOKENS.find((m) => lower.startsWith(m.prefix));
  return Math.min(
    match ? match.tokens : DEFAULT_OLLAMA_CONTEXT_TOKENS,
    PRACTICAL_MAX_TOKENS,
  );
}

/**
 * Character budget summarizeText should chunk its input into for the given
 * model: bigger for Ollama models with real context headroom, capped to
 * WebLLM's uniformly small 4096-token in-browser window otherwise.
 */
export function getMaxChunkChars(model) {
  let contextTokens;
  if ((model || "").endsWith("-MLC")) {
    contextTokens = WEBLLM_CONTEXT_TOKENS;
  } else if (isTransformersModel(model)) {
    contextTokens = TRANSFORMERS_CONTEXT_TOKENS;
  } else {
    contextTokens = getOllamaContextTokens(model);
  }
  const usableTokens = Math.max(contextTokens - RESERVED_TOKENS, 512);
  return usableTokens * CHARS_PER_TOKEN;
}
