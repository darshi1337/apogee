import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  isKnownWebLLMModelId,
} from "../constants.js";
import { validateLlamaHost, validateOllamaHost } from "../util/ollamaHost.js";
import {
  REMOTE_PROVIDER_IDS,
  hasRemoteControlCharacters,
  validRemoteModelId,
} from "../engines/remoteModels.js";

const PROVIDER_VALUES = new Set(Object.values(PROVIDERS));

function sanitizeSettings(settings) {
  const clean = { ...settings };
  for (const provider of REMOTE_PROVIDER_IDS) {
    clean[`${provider}Consent`] = clean[`${provider}Consent`] === true;
    clean[`${provider}GenerationConsent`] =
      clean[`${provider}GenerationConsent`] === true;
    const revision = clean[`${provider}GenerationRevision`];
    clean[`${provider}GenerationRevision`] =
      Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    const key = clean[`${provider}ApiKey`];
    clean[`${provider}ApiKey`] =
      typeof key === "string" &&
      key.length <= 4096 &&
      !hasRemoteControlCharacters(key)
        ? key.trim()
        : "";
    const model = clean[`${provider}Model`];
    clean[`${provider}Model`] = validRemoteModelId(model) ? model : "";
  }
  // Corrupted stores must not flip provider or hosts: fall back to
  // defaults and revalidate through the shared loopback validator.
  clean.autoEngine = Boolean(clean.autoEngine);
  if (!PROVIDER_VALUES.has(clean.provider)) {
    clean.provider = DEFAULT_SETTINGS.provider;
  }
  // Unknown model ids would fetch config from the remote CDN, so reset
  // to the default instead of passing them through.
  if (!isKnownWebLLMModelId(clean.webllmModel)) {
    clean.webllmModel = DEFAULT_SETTINGS.webllmModel;
  }
  try {
    clean.ollamaHost = validateOllamaHost(clean.ollamaHost);
  } catch {
    clean.ollamaHost = DEFAULT_SETTINGS.ollamaHost;
  }
  try {
    clean.llamaHost = validateLlamaHost(clean.llamaHost);
  } catch {
    clean.llamaHost = DEFAULT_SETTINGS.llamaHost;
  }
  return clean;
}

export async function getRemoteCredentialsSettings() {
  const stored = await chrome.storage.local.get("settings");
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...(stored.settings || {}) });
}

function redactRemoteCredentials(settings) {
  const clean = { ...settings };
  for (const provider of REMOTE_PROVIDER_IDS) {
    clean[`${provider}HasApiKey`] = !!clean[`${provider}ApiKey`];
    delete clean[`${provider}ApiKey`];
  }
  return clean;
}

export async function getSettings() {
  return redactRemoteCredentials(await getRemoteCredentialsSettings());
}

const remoteFields = new Set(
  REMOTE_PROVIDER_IDS.flatMap((provider) =>
    [
      "ApiKey",
      "Consent",
      "Model",
      "GenerationConsent",
      "GenerationRevision",
      "HasApiKey",
    ].map((suffix) => `${provider}${suffix}`),
  ),
);
let settingsWrite = Promise.resolve();
function writeSettings(partial, remote) {
  const write = async () => {
    const current = await getRemoteCredentialsSettings();
    const incoming =
      typeof partial === "function"
        ? partial(remote ? current : redactRemoteCredentials(current))
        : partial;
    const allowed = Object.fromEntries(
      Object.entries(incoming || {}).filter(([key]) =>
        remote
          ? remoteFields.has(key) &&
            !key.endsWith("GenerationRevision") &&
            !key.endsWith("HasApiKey")
          : !remoteFields.has(key),
      ),
    );
    const settings = sanitizeSettings({ ...current, ...allowed });
    for (const provider of REMOTE_PROVIDER_IDS) {
      if (
        ["GenerationConsent", "ApiKey", "Model"].some(
          (suffix) =>
            current[`${provider}${suffix}`] !==
            settings[`${provider}${suffix}`],
        )
      ) {
        if (
          current[`${provider}GenerationRevision`] === Number.MAX_SAFE_INTEGER
        )
          throw new Error("Remote settings revision exhausted.");
        settings[`${provider}GenerationRevision`] =
          current[`${provider}GenerationRevision`] + 1;
      }
    }
    await chrome.storage.local.set({ settings });
    return redactRemoteCredentials(settings);
  };
  const run = () =>
    globalThis.navigator?.locks
      ? navigator.locks.request("apogee-settings", write)
      : write();
  const operation = settingsWrite.then(run);
  settingsWrite = operation.catch(() => {});
  return operation;
}

export function updateSettings(partial) {
  return writeSettings(partial, false);
}

export function updateRemoteCredentialsSettings(partial) {
  return writeSettings(partial, true);
}
