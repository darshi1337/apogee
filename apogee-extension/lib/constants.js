// WebLLM model catalog, smaller quantized models suited for browser inference.
// The IDs must match entries in @mlc-ai/web-llm's prebuiltAppConfig.

export const WEBLLM_MODELS = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 1.5B",
    size: "~900 MB",
    description: "Multilingual, instruction-tuned. Great for summarization.",
    default: true,
  },
  {
    id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    label: "SmolLM2 1.7B",
    size: "~1 GB",
    description: "Compact and efficient for general tasks.",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    size: "~700 MB",
    description: "Lightweight, fast, and reliable.",
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini",
    size: "~2.2 GB",
    description: "Stronger reasoning, larger download.",
  },
];

export const DEFAULT_WEBLLM_MODEL = WEBLLM_MODELS.find((m) => m.default).id;
export const LOCAL_MODELS = [
  { id: "qwen3:8b", label: "Qwen 3 8B" },
  { id: "mistral:latest", label: "Mistral Latest" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B" },
  { id: "gemma3:4b", label: "Gemma 3" },
];

export const DEFAULT_LOCAL_MODEL = "qwen3:8b";

const isFirefox = process.env.TARGET_BROWSER === "firefox";

export const PROVIDERS = isFirefox
  ? { LOCAL: "local" }
  : { WEBLLM: "webllm", LOCAL: "local" };

export const DEFAULT_PROVIDER = isFirefox ? PROVIDERS.LOCAL : PROVIDERS.WEBLLM;

// Ollama's own default HTTP port. The extension talks to Ollama directly,
// no intermediate backend server.
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export const DEFAULT_SETTINGS = {
  provider: DEFAULT_PROVIDER,
  webllmModel: DEFAULT_WEBLLM_MODEL,
  localModel: DEFAULT_LOCAL_MODEL,
  ollamaHost: DEFAULT_OLLAMA_HOST,
  responseFormat: "bullets",
  theme: "dark",
  // When false, summaries/page content/Q&A are never written to disk (kept
  // only in memory for the current popup session). Sensitive hosts (see
  // isSensitiveUrl in popup.js) are always treated as non-persistable
  // regardless of this setting.
  saveHistory: true,
};
