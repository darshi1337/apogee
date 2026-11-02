import { getSettings, updateSettings } from "./settings.js";
import {
  abortRemoteRequests,
  fetchRemoteModels,
  holdRemoteRequests,
} from "../engines/remoteClient.js";
import {
  remotePreset,
  validRemoteModelId,
  hasRemoteControlCharacters,
} from "../engines/remoteModels.js";

const PROVIDER_IDS = ["openrouter", "opencode"];
export const REMOTE_CATALOG_TTL_MS = 60 * 60 * 1000;
const revisions = new Map();
let pendingSave = Promise.resolve();
let listenedStorage;
const refreshes = new Map();

const catalogKey = (provider) => `remoteCatalog:${provider}`;
async function readCatalog(provider) {
  const key = catalogKey(provider);
  const cache = (await chrome.storage.local.get(key))[key];
  if (
    !cache ||
    !Number.isFinite(cache.refreshedAt) ||
    cache.refreshedAt <= 0 ||
    cache.refreshedAt > Date.now() ||
    !Array.isArray(cache.models) ||
    cache.models.length > 1000
  )
    return null;
  const models = cache.models
    .filter(
      (entry) =>
        validRemoteModelId(entry?.id) &&
        typeof entry.label === "string" &&
        entry.label.length <= 160 &&
        !hasRemoteControlCharacters(entry.label),
    )
    .map(({ id, label, contextTokens }) => ({
      id,
      label,
      contextTokens:
        Number.isSafeInteger(contextTokens) &&
        contextTokens > 0 &&
        contextTokens <= 10000000
          ? contextTokens
          : null,
    }));
  return {
    models,
    refreshedAt: cache.refreshedAt,
    failed: cache.failed === true,
  };
}

function listenForRevocation() {
  const events = chrome.storage.onChanged;
  if (!events?.addListener || listenedStorage === events) return;
  listenedStorage = events;
  events.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const { oldValue = {}, newValue = {} } = changes.settings;
    for (const provider of PROVIDER_IDS) {
      if (
        (oldValue[`${provider}Consent`] === true &&
          newValue[`${provider}Consent`] !== true) ||
        oldValue[`${provider}ApiKey`] !== newValue[`${provider}ApiKey`]
      )
        invalidate(provider);
    }
  });
}

function invalidate(provider) {
  revisions.set(provider, (revisions.get(provider) || 0) + 1);
  abortRemoteRequests(provider);
  chrome.storage.local.remove(catalogKey(provider)).catch(() => {});
}

export async function getRemoteSettings() {
  listenForRevocation();
  const settings = await getSettings();
  const providers = {};
  for (const provider of PROVIDER_IDS) {
    const cache = await readCatalog(provider);
    const consent = settings[`${provider}Consent`] === true;
    const hasApiKey = !!settings[`${provider}ApiKey`];
    providers[provider] = {
      consent,
      hasApiKey,
      model: settings[`${provider}Model`],
      catalog: {
        models:
          consent && hasApiKey && cache
            ? cache.models.map((model) => ({ ...model }))
            : [],
        refreshedAt: consent && hasApiKey && cache ? cache.refreshedAt : null,
        stale:
          !consent ||
          !hasApiKey ||
          !cache ||
          cache.failed ||
          Date.now() - cache.refreshedAt >= REMOTE_CATALOG_TTL_MS,
      },
    };
  }
  return { providers };
}

export async function saveRemoteSettings(payload) {
  listenForRevocation();
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid remote settings.");
  const { provider } = payload;
  remotePreset(provider);
  if (
    Object.keys(payload).some(
      (key) => !["provider", "apiKey", "consent", "model"].includes(key),
    )
  )
    throw new Error("Invalid remote settings.");
  const has = (key) => Object.hasOwn(payload, key);
  if (
    has("apiKey") &&
    (typeof payload.apiKey !== "string" ||
      payload.apiKey.length > 4096 ||
      hasRemoteControlCharacters(payload.apiKey))
  )
    throw new Error("Invalid API key.");
  if (has("consent") && typeof payload.consent !== "boolean")
    throw new Error("Invalid remote consent.");
  if (
    has("model") &&
    payload.model !== "" &&
    !validRemoteModelId(payload.model)
  )
    throw new Error("Invalid remote model.");
  // Synchronous invalidation makes revocation cancel requests already awaiting
  // storage or fetch, even when another settings write is still pending.
  const release = holdRemoteRequests(provider);
  if (has("apiKey") || has("consent")) invalidate(provider);
  const operation = pendingSave
    .then(async () => {
      const settings = await getSettings();
      if (has("model") && payload.model) {
        const cache = await readCatalog(provider);
        if (
          !cache ||
          cache.failed ||
          Date.now() - cache.refreshedAt >= REMOTE_CATALOG_TTL_MS ||
          !cache.models.some((entry) => entry.id === payload.model)
        )
          throw new Error("Refresh the catalog and select an eligible model.");
      }
      if (has("apiKey")) {
        if (settings[`${provider}ApiKey`] !== payload.apiKey.trim())
          settings[`${provider}Model`] = "";
        settings[`${provider}ApiKey`] = payload.apiKey.trim();
      }
      if (has("consent")) settings[`${provider}Consent`] = payload.consent;
      if (has("model")) settings[`${provider}Model`] = payload.model;
      if (!settings[`${provider}Consent`] || !settings[`${provider}ApiKey`])
        settings[`${provider}Model`] = "";
      await updateSettings(
        Object.fromEntries(
          ["ApiKey", "Consent", "Model"].map((suffix) => [
            `${provider}${suffix}`,
            settings[`${provider}${suffix}`],
          ]),
        ),
      );
      return getRemoteSettings();
    })
    .finally(release);
  pendingSave = operation.catch(() => {});
  return operation;
}

export function refreshRemoteModels(provider) {
  remotePreset(provider);
  if (refreshes.has(provider)) return refreshes.get(provider);
  const refresh = refreshCatalog(provider).finally(() => {
    if (refreshes.get(provider) === refresh) refreshes.delete(provider);
  });
  refreshes.set(provider, refresh);
  return refresh;
}

async function refreshCatalog(provider) {
  listenForRevocation();
  remotePreset(provider);
  await pendingSave;
  const revision = revisions.get(provider) || 0;
  const before = await getSettings();
  let models;
  try {
    models = await fetchRemoteModels(provider);
  } catch (error) {
    const cache = await readCatalog(provider);
    if (cache && revision === (revisions.get(provider) || 0)) {
      await chrome.storage.local.set({
        [catalogKey(provider)]: { ...cache, failed: true },
      });
      if (revision !== (revisions.get(provider) || 0))
        await chrome.storage.local.remove(catalogKey(provider));
    }
    throw error;
  }
  const after = await getSettings();
  if (
    revision !== (revisions.get(provider) || 0) ||
    !after[`${provider}Consent`] ||
    before[`${provider}ApiKey`] !== after[`${provider}ApiKey`]
  )
    throw new Error("Remote settings changed. Refresh again.");
  await chrome.storage.local.set({
    [catalogKey(provider)]: { models, refreshedAt: Date.now(), failed: false },
  });
  const committed = await getSettings();
  if (
    revision !== (revisions.get(provider) || 0) ||
    !committed[`${provider}Consent`] ||
    committed[`${provider}ApiKey`] !== before[`${provider}ApiKey`]
  ) {
    await chrome.storage.local.remove(catalogKey(provider));
    throw new Error("Remote settings changed. Refresh again.");
  }
  await updateSettings((current) => {
    if (
      revision !== (revisions.get(provider) || 0) ||
      !current[`${provider}Consent`] ||
      current[`${provider}ApiKey`] !== before[`${provider}ApiKey`]
    )
      return {};
    return current[`${provider}Model`] &&
      !models.some((entry) => entry.id === current[`${provider}Model`])
      ? { [`${provider}Model`]: "" }
      : {};
  });
  return getRemoteSettings();
}
