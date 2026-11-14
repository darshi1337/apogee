import { onRemoteCredentialChange } from "../engines/remoteCredentials.js";
import {
  getRemoteCredentialsSettings,
  updateRemoteCredentialsSettings,
} from "./settings.js";
import {
  abortRemoteRequests,
  fetchRemoteModels,
  holdRemoteRequests,
  remoteRequestsHeld,
} from "../engines/remoteClient.js";
import {
  REMOTE_PROVIDER_IDS,
  remotePreset,
  validRemoteModelId,
  hasRemoteControlCharacters,
} from "../engines/remoteModels.js";

const REMOTE_CATALOG_TTL_MS = 60 * 60 * 1000;

const revisions = new Map();
let pendingSave = Promise.resolve();
let pendingInvalidation = Promise.resolve();
const refreshes = new Map();

function catalogIsFresh(cache, now = Date.now()) {
  return Boolean(
    cache &&
    !cache.failed &&
    Number.isFinite(cache.refreshedAt) &&
    cache.refreshedAt > 0 &&
    cache.refreshedAt <= now &&
    now - cache.refreshedAt < REMOTE_CATALOG_TTL_MS,
  );
}

function settingsStillMatch(settings, before, provider, revision) {
  return (
    revision === (revisions.get(provider) || 0) &&
    settings[`${provider}Consent`] === true &&
    settings[`${provider}ApiKey`] === before[`${provider}ApiKey`]
  );
}

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

let listening = false;
function listenForRevocation() {
  if (listening) return;
  listening = true;
  onRemoteCredentialChange((provider) => void invalidate(provider));
}

function invalidate(provider) {
  revisions.set(provider, (revisions.get(provider) || 0) + 1);
  abortRemoteRequests(provider);
  const removal = pendingInvalidation
    .then(() => chrome.storage.local.remove(catalogKey(provider)))
    .catch(() => {});
  pendingInvalidation = removal;
  return removal;
}

export async function getRemoteSettings() {
  listenForRevocation();
  await pendingInvalidation;
  const settings = await getRemoteCredentialsSettings();
  const providers = {};
  for (const provider of REMOTE_PROVIDER_IDS) {
    const cache = await readCatalog(provider);
    const consent = settings[`${provider}Consent`] === true;
    const hasApiKey = !!settings[`${provider}ApiKey`];
    providers[provider] = {
      consent,
      // Heal legacy state where generation consent was saved without catalog
      // consent: generation consent is a subset and must not appear enabled.
      generationConsent:
        consent && settings[`${provider}GenerationConsent`] === true,
      backgroundConsent: settings[`${provider}BackgroundConsent`] === true,
      suggestionsConsent: settings[`${provider}SuggestionsConsent`] === true,
      generationRevision: settings[`${provider}GenerationRevision`],
      hasApiKey,
      model: settings[`${provider}Model`],
      catalog: {
        models:
          consent && hasApiKey && cache
            ? cache.models.map((model) => ({ ...model }))
            : [],
        refreshedAt: consent && hasApiKey && cache ? cache.refreshedAt : null,
        stale:
          Boolean(cache) && (!consent || !hasApiKey || !catalogIsFresh(cache)),
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
      (key) =>
        ![
          "provider",
          "apiKey",
          "consent",
          "generationConsent",
          "backgroundConsent",
          "suggestionsConsent",
          "model",
        ].includes(key),
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
    has("generationConsent") &&
    typeof payload.generationConsent !== "boolean"
  )
    throw new Error("Invalid generation consent.");
  for (const field of ["backgroundConsent", "suggestionsConsent"])
    if (has(field) && typeof payload[field] !== "boolean")
      throw new Error("Invalid remote consent.");
  if (
    has("model") &&
    payload.model !== "" &&
    !validRemoteModelId(payload.model)
  )
    throw new Error("Invalid remote model.");
  if (has("model") && (has("apiKey") || has("consent")))
    throw new Error("Save credentials and model separately.");
  // Holding aborts requests that may still be using the old credentials. The
  // cache is removed only when a credential actually changes.
  const release = holdRemoteRequests(provider, {
    abort:
      has("apiKey") ||
      has("consent") ||
      has("generationConsent") ||
      has("backgroundConsent") ||
      has("suggestionsConsent") ||
      has("model"),
  });
  const operation = pendingSave
    .then(async () => {
      await pendingInvalidation;
      const settings = await getRemoteCredentialsSettings();
      const apiKey = has("apiKey")
        ? payload.apiKey.trim()
        : settings[`${provider}ApiKey`];
      const keyChanged =
        has("apiKey") && settings[`${provider}ApiKey`] !== apiKey;
      const consentChanged =
        has("consent") && settings[`${provider}Consent`] !== payload.consent;
      const previousConsent = settings[`${provider}Consent`] === true;
      const nextConsent = has("consent") ? payload.consent : previousConsent;
      const revokingCatalogConsent =
        has("consent") && payload.consent === false;
      // Generation consent is a strict subset of catalog consent. Accepting it
      // on its own without consent would persist an unusable state and weaken
      // the boundary that keeps the two opt-ins separate. Revoking catalog
      // consent in the same save clears generation consent instead of throwing.
      if (
        has("generationConsent") &&
        payload.generationConsent === true &&
        !nextConsent &&
        !revokingCatalogConsent
      )
        throw new Error(
          "Remote consent is required before enabling remote generation.",
        );
      const nextGenerationConsent = has("generationConsent")
        ? payload.generationConsent
        : settings[`${provider}GenerationConsent`];
      if (
        nextConsent &&
        !nextGenerationConsent &&
        ["backgroundConsent", "suggestionsConsent"].some(
          (field) => payload[field] === true,
        )
      )
        throw new Error(
          "Generation consent is required before enabling additional remote generation.",
        );
      for (const [field, suffix] of [
        ["backgroundConsent", "BackgroundConsent"],
        ["suggestionsConsent", "SuggestionsConsent"],
      ]) {
        if (!nextConsent || !nextGenerationConsent)
          settings[`${provider}${suffix}`] = false;
        else if (has(field)) settings[`${provider}${suffix}`] = payload[field];
      }
      if (has("model") && payload.model) {
        const cache = await readCatalog(provider);
        if (
          !catalogIsFresh(cache) ||
          !cache.models.some((entry) => entry.id === payload.model)
        )
          throw new Error("Refresh the catalog and select an eligible model.");
      }
      if (keyChanged) settings[`${provider}Model`] = "";
      if (has("apiKey")) settings[`${provider}ApiKey`] = apiKey;
      if (has("consent")) settings[`${provider}Consent`] = payload.consent;
      if (has("generationConsent"))
        settings[`${provider}GenerationConsent`] = payload.generationConsent;
      if (revokingCatalogConsent)
        settings[`${provider}GenerationConsent`] = false;
      else if (
        has("consent") &&
        payload.consent &&
        !previousConsent &&
        !has("generationConsent")
      )
        // A legacy or externally written state can hold generation consent
        // while catalog consent is off. Enabling catalog consent again must not
        // resurrect that hidden value.
        settings[`${provider}GenerationConsent`] = false;
      if (has("model")) settings[`${provider}Model`] = payload.model;
      if (!settings[`${provider}Consent`]) {
        settings[`${provider}GenerationConsent`] = false;
        settings[`${provider}Model`] = "";
      } else if (!settings[`${provider}ApiKey`])
        settings[`${provider}Model`] = "";
      await updateRemoteCredentialsSettings(
        Object.fromEntries(
          [
            "ApiKey",
            "Consent",
            "Model",
            "GenerationConsent",
            "BackgroundConsent",
            "SuggestionsConsent",
          ].map((suffix) => [
            `${provider}${suffix}`,
            settings[`${provider}${suffix}`],
          ]),
        ),
      );
      if (keyChanged || consentChanged) await invalidate(provider);
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
  await pendingInvalidation;
  const revision = revisions.get(provider) || 0;
  const before = await getRemoteCredentialsSettings();
  let models;
  try {
    models = await fetchRemoteModels(provider);
  } catch (error) {
    const cache = await readCatalog(provider);
    if (
      cache &&
      revision === (revisions.get(provider) || 0) &&
      !remoteRequestsHeld(provider)
    ) {
      await chrome.storage.local.set({
        [catalogKey(provider)]: { ...cache, failed: true },
      });
      if (revision !== (revisions.get(provider) || 0))
        await chrome.storage.local.remove(catalogKey(provider));
    }
    throw error;
  }
  const after = await getRemoteCredentialsSettings();
  if (!settingsStillMatch(after, before, provider, revision))
    throw new Error("Remote settings changed. Refresh again.");
  await chrome.storage.local.set({
    [catalogKey(provider)]: { models, refreshedAt: Date.now(), failed: false },
  });
  const committed = await getRemoteCredentialsSettings();
  if (!settingsStillMatch(committed, before, provider, revision)) {
    await chrome.storage.local.remove(catalogKey(provider));
    throw new Error("Remote settings changed. Refresh again.");
  }
  await updateRemoteCredentialsSettings((current) => {
    if (!settingsStillMatch(current, before, provider, revision)) return {};
    return current[`${provider}Model`] &&
      !models.some((entry) => entry.id === current[`${provider}Model`])
      ? { [`${provider}Model`]: "" }
      : {};
  });
  return getRemoteSettings();
}
