import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  isKnownWebLLMModelId,
} from "../constants.js";
import { validateLlamaHost, validateOllamaHost } from "../util/ollamaHost.js";

const PROVIDER_VALUES = new Set(Object.values(PROVIDERS));

function sanitizeSettings(settings) {
  const clean = { ...settings };
  // A corrupted store must not flip the provider or loopback hosts: unknown
  // providers fall back to the default, and hosts go through the same shared
  // validator the service worker enforces at request time.
  if (!PROVIDER_VALUES.has(clean.provider)) {
    clean.provider = DEFAULT_SETTINGS.provider;
  }
  // An unknown WebLLM model id would make the offscreen engine fetch config
  // from the remote CDN instead of the bundled libs, so reset it to the
  // default rather than passing it through.
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

export async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...(stored.settings || {}) });
}
