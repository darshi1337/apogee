import { DEFAULT_SETTINGS, PROVIDERS } from "../constants.js";
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
