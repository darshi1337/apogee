import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  isKnownWebLLMModelId,
} from "../constants.js";
import { validateLlamaHost, validateOllamaHost } from "../util/ollamaHost.js";

const PROVIDER_VALUES = new Set(Object.values(PROVIDERS));

function sanitizeSettings(settings) {
  const clean = { ...settings };
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

export async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...(stored.settings || {}) });
}
