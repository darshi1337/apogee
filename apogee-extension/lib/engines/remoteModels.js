// Fixed origins and eligibility rules for opt-in remote catalogs and generation.
const PRESETS = Object.freeze({
  openrouter: Object.freeze({
    base: "https://openrouter.ai/api/v1",
    catalog: "https://openrouter.ai/api/v1/models",
  }),
  opencode: Object.freeze({
    base: "https://opencode.ai/inference/openai/v1",
    catalog: "https://opencode.ai/inference/v1/models",
  }),
});

export const REMOTE_PROVIDER_IDS = Object.freeze(Object.keys(PRESETS));

export function isRemoteProvider(provider) {
  return REMOTE_PROVIDER_IDS.includes(provider);
}

export function remotePreset(provider) {
  if (!Object.hasOwn(PRESETS, provider))
    throw new Error("Unknown remote preset.");
  return PRESETS[provider];
}

export function validRemoteModelId(value) {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(value)
  );
}

export function hasRemoteControlCharacters(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
}

function zero(value) {
  return (
    (typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(Number(value)) &&
    Number(value) === 0
  );
}

const CHAT_ENDPOINT_NAMES = new Set([
  "/api/v1/chat/completions",
  "chat/completions",
  "chat",
]);

// OpenRouter catalog entries may name endpoints as plain strings or as
// objects with an endpoint, path, name, url, or type field depending on the
// API version.
function endpointName(endpoint) {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object") {
    for (const field of ["endpoint", "path", "name", "url", "type"]) {
      if (typeof endpoint[field] === "string") return endpoint[field];
    }
  }
  return null;
}

function supportsChatCompletions(entry) {
  const endpoints = Array.isArray(entry.endpoints)
    ? entry.endpoints
    : Array.isArray(entry.supported_endpoints)
      ? entry.supported_endpoints
      : null;
  if (!endpoints) return true;
  return endpoints.some((endpoint) =>
    CHAT_ENDPOINT_NAMES.has(endpointName(endpoint)),
  );
}

// A summarizer needs a text answer. Models that also emit audio or images can
// carry per-clip charges that the token pricing fields do not show.
function textOnlyOutput(modalities) {
  return (
    Array.isArray(modalities) &&
    modalities.length > 0 &&
    modalities.every((modality) => modality === "text")
  );
}

function normalizedBaseUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export function normalizeRemoteModels(provider, payload) {
  remotePreset(provider);
  if (!Array.isArray(payload?.data))
    throw new Error("Remote catalog is unavailable.");
  const opencodeBase = normalizedBaseUrl(PRESETS.opencode.base);
  const models = new Map();
  for (const entry of payload.data.slice(0, 10000)) {
    if (!validRemoteModelId(entry?.id)) continue;
    if (provider === "openrouter") {
      if (!zero(entry.pricing?.prompt) || !zero(entry.pricing?.completion))
        continue;
      // Unknown additional charges fail closed as well.
      if (Object.values(entry.pricing).some((value) => !zero(value))) continue;
      if (
        !entry.architecture?.input_modalities?.includes("text") ||
        !textOnlyOutput(entry.architecture?.output_modalities)
      )
        continue;
      if (!supportsChatCompletions(entry)) continue;
    } else {
      // Credits and Go are billing plans, never a claim that inference is free.
      if (
        entry.type !== "chat" ||
        normalizedBaseUrl(entry.api?.["chat-completions"]?.base_url) !==
          opencodeBase
      )
        continue;
      if (
        !entry.modalities?.input?.includes("text") ||
        !textOnlyOutput(entry.modalities?.output)
      )
        continue;
      const input = entry.cost?.text?.input?.price;
      const output = entry.cost?.text?.output?.price;
      if (
        typeof input !== "number" ||
        typeof output !== "number" ||
        !Number.isFinite(input) ||
        !Number.isFinite(output) ||
        input < 0 ||
        output < 0 ||
        input + output <= 0
      )
        continue;
    }
    const label =
      typeof entry.name === "string"
        ? Array.from(entry.name)
            .filter((character) => !hasRemoteControlCharacters(character))
            .join("")
            .slice(0, 160)
        : entry.id;
    const context =
      provider === "openrouter" ? entry.context_length : entry.limit?.context;
    const contextTokens =
      Number.isSafeInteger(context) && context > 0 && context <= 10000000
        ? context
        : null;
    models.set(entry.id, { id: entry.id, label, contextTokens });
    if (models.size >= 1000) break;
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
