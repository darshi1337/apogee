export const WEBLLM_MODELS = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    lib: "Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "Qwen 2.5 1.5B",
    size: "~900 MB",
    description: "Multilingual, instruction-tuned. Great for summarization.",
    default: true,
  },
  {
    id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    lib: "SmolLM2-1.7B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "SmolLM2 1.7B",
    size: "~1 GB",
    description: "Compact and efficient for general tasks.",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    lib: "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "Llama 3.2 1B",
    size: "~700 MB",
    description: "Lightweight, fast, and reliable.",
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    lib: "Phi-3.5-mini-instruct-q4f16_1_cs1k-webgpu.wasm",
    label: "Phi 3.5 Mini",
    size: "~2.2 GB",
    description: "Stronger reasoning, larger download.",
  },
];

const DEFAULT_WEBLLM_MODEL = WEBLLM_MODELS.find((m) => m.default).id;

export const TRANSFORMERS_MODELS = [
  {
    id: "HuggingFaceTB/SmolLM2-360M-Instruct",
    dtype: "q4f16",
    label: "SmolLM2 360M",
    size: "~270 MB",
    description: "Smallest and fastest, best for quick summaries on CPU.",
    default: true,
  },
  {
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    dtype: "q4f16",
    label: "Qwen 2.5 0.5B",
    size: "~480 MB",
    description: "Multilingual, instruction-tuned.",
  },
  {
    id: "onnx-community/Llama-3.2-1B-Instruct-q4f16",
    dtype: "q4f16",
    label: "Llama 3.2 1B",
    size: "~1.2 GB",
    description: "Stronger reasoning, larger download and slower on CPU.",
  },
];

const DEFAULT_TRANSFORMERS_MODEL = TRANSFORMERS_MODELS.find(
  (m) => m.default,
).id;

export const SUMMARY_LANGUAGES = [
  { code: "auto", label: "Same as article", name: null },
  { code: "en", label: "English", name: "English" },
  { code: "es", label: "Spanish", name: "Spanish" },
  { code: "fr", label: "French", name: "French" },
  { code: "de", label: "German", name: "German" },
  { code: "it", label: "Italian", name: "Italian" },
  { code: "pt", label: "Portuguese", name: "Portuguese" },
  { code: "nl", label: "Dutch", name: "Dutch" },
  { code: "pl", label: "Polish", name: "Polish" },
  { code: "ru", label: "Russian", name: "Russian" },
  { code: "uk", label: "Ukrainian", name: "Ukrainian" },
  { code: "cs", label: "Czech", name: "Czech" },
  { code: "sk", label: "Slovak", name: "Slovak" },
  { code: "sl", label: "Slovenian", name: "Slovenian" },
  { code: "bg", label: "Bulgarian", name: "Bulgarian" },
  { code: "ro", label: "Romanian", name: "Romanian" },
  { code: "hu", label: "Hungarian", name: "Hungarian" },
  { code: "el", label: "Greek", name: "Greek" },
  { code: "tr", label: "Turkish", name: "Turkish" },
  { code: "sv", label: "Swedish", name: "Swedish" },
  { code: "da", label: "Danish", name: "Danish" },
  { code: "nb", label: "Norwegian", name: "Norwegian" },
  { code: "fi", label: "Finnish", name: "Finnish" },
  { code: "et", label: "Estonian", name: "Estonian" },
  { code: "lv", label: "Latvian", name: "Latvian" },
  { code: "lt", label: "Lithuanian", name: "Lithuanian" },
  { code: "ja", label: "Japanese", name: "Japanese" },
  { code: "ko", label: "Korean", name: "Korean" },
  { code: "zh", label: "Chinese (Simplified)", name: "Simplified Chinese" },
  {
    code: "zh-hant",
    label: "Chinese (Traditional)",
    name: "Traditional Chinese",
  },
  { code: "id", label: "Indonesian", name: "Indonesian" },
  { code: "hi", label: "Hindi", name: "Hindi" },
  { code: "vi", label: "Vietnamese", name: "Vietnamese" },
  { code: "th", label: "Thai", name: "Thai" },
];

const VIDEO_PAGE_TYPES = new Set(["youtube", "bilibili"]);

export function isVideoType(type) {
  return VIDEO_PAGE_TYPES.has(type);
}

const DEFAULT_SUMMARY_LANGUAGE = "en";

export const CUSTOM_INSTRUCTIONS_MAX_CHARS = 2000;

export const PRIVATE_HOSTS_MAX_CHARS = 1000;

export const TRANSLATION_ENGINES = { LLM: "llm", OPUS: "opus" };
const DEFAULT_TRANSLATION_ENGINE = TRANSLATION_ENGINES.OPUS;

export const EXPERIMENTAL_WASM_THREADS = false;

export const LOCAL_MODELS = [
  { id: "qwen3:8b", label: "Qwen 3 8B" },
  { id: "mistral:latest", label: "Mistral Latest" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B" },
  { id: "gemma3:4b", label: "Gemma 3" },
];

const DEFAULT_LOCAL_MODEL = "qwen3:8b";

const isFirefox = process.env.TARGET_BROWSER === "firefox";

// llama.cpp is offered on both builds: like Ollama it is a plain fetch to a loopback server, with none of the WebGPU or offscreen-document dependency that keeps WebLLM off Firefox.
export const PROVIDERS = isFirefox
  ? { TRANSFORMERS: "transformers", LOCAL: "local", LLAMACPP: "llamacpp" }
  : {
      WEBLLM: "webllm",
      TRANSFORMERS: "transformers",
      LOCAL: "local",
      LLAMACPP: "llamacpp",
    };

export const DEFAULT_PROVIDER = isFirefox
  ? PROVIDERS.TRANSFORMERS
  : PROVIDERS.WEBLLM;

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export const DEFAULT_LLAMACPP_HOST = "http://127.0.0.1:8080";

export const DEFAULT_SETTINGS = {
  provider: DEFAULT_PROVIDER,
  webllmModel: DEFAULT_WEBLLM_MODEL,
  transformersModel: DEFAULT_TRANSFORMERS_MODEL,
  localModel: DEFAULT_LOCAL_MODEL,
  ollamaHost: DEFAULT_OLLAMA_HOST,
  // llama-server loads one model at launch, so there is no list to pick from and no sensible default to ship: the name is filled in from the server once it answers. The API key stays empty unless the server was started with --api-key, which most are not.
  llamaHost: DEFAULT_LLAMACPP_HOST,
  llamaModel: "",
  llamaApiKey: "",
  responseFormat: "bullets",
  customInstructions: "",
  summaryLanguage: DEFAULT_SUMMARY_LANGUAGE,
  translationEngine: DEFAULT_TRANSLATION_ENGINE,
  theme: "dark",
  saveHistory: true,
  privateHosts: "",
  useSponsorBlock: true,
  debugLogs: false,
};
