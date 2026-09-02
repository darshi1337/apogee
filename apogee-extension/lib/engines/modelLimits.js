import { TRANSFORMERS_MODELS } from "../constants.js";

const WEBLLM_CONTEXT_TOKENS = 4096;

const TRANSFORMERS_CONTEXT_TOKENS = 3072;

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

const DEFAULT_OLLAMA_CONTEXT_TOKENS = 8192;

const PRACTICAL_MAX_TOKENS = 24000;

const RESERVED_TOKENS = 2048;

const CHARS_PER_TOKEN = 4;

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

function isPositiveTokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * How much text to put in one chunk for a given model.
 *
 * Every branch below infers the context window from the model name, which
 * works while the name implies the window. It does not always: a llama.cpp
 * server takes its window from its own `-c` launch flag, so the same GGUF can
 * be serving 4096 tokens or 32768 and the name reads identically either way.
 * Guessing there is not merely imprecise, it can overflow -- a model named for
 * a 128k window, run with `-c 4096`, would be handed chunks twenty times too
 * large. So a caller that has asked the server what it is actually running
 * passes `contextTokensOverride`, and that wins outright.
 *
 * Callers without one pass nothing and keep the name-based behaviour.
 */
export function getMaxChunkChars(model, contextTokensOverride) {
  let contextTokens;
  if (isPositiveTokenCount(contextTokensOverride)) {
    // Still capped: a reported 128k window would otherwise produce a single chunk far larger than is practical to generate from.
    contextTokens = Math.min(contextTokensOverride, PRACTICAL_MAX_TOKENS);
  } else if ((model || "").endsWith("-MLC")) {
    contextTokens = WEBLLM_CONTEXT_TOKENS;
  } else if (isTransformersModel(model)) {
    contextTokens = TRANSFORMERS_CONTEXT_TOKENS;
  } else {
    contextTokens = getOllamaContextTokens(model);
  }
  const usableTokens = Math.max(contextTokens - RESERVED_TOKENS, 512);
  return usableTokens * CHARS_PER_TOKEN;
}

export function getMaxChunks(model) {
  return isTransformersModel(model) ? 4 : 12;
}
