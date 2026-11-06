import { REMOTE_PROVIDER_IDS } from "./remoteModels.js";

export const REMOTE_GENERATION_DATA = [
  "authenticationInfo",
  "websiteContent",
  "browsingActivity",
  "personalCommunications",
];

export async function hasRemoteCatalogPermissions() {
  return (
    process.env.TARGET_BROWSER !== "firefox" ||
    (await chrome.permissions.contains({
      data_collection: ["authenticationInfo"],
    }))
  );
}

export async function hasRemoteGenerationPermissions() {
  return (
    process.env.TARGET_BROWSER !== "firefox" ||
    (await chrome.permissions.contains({
      data_collection: REMOTE_GENERATION_DATA,
    }))
  );
}

const listeners = new Set();
const generationListeners = new Set();
let watchedStorage;

// Shared chrome.storage.onChanged subscription for remote credential changes.
// Subscribers are notified once per affected provider, in registration order.
export function onRemoteCredentialChange(listener) {
  listeners.add(listener);
  watchStorage();
}

export function onRemoteGenerationChange(listener) {
  generationListeners.add(listener);
  watchStorage();
}

function watchStorage() {
  const events = chrome.storage.onChanged;
  if (!events?.addListener) return;
  if (watchedStorage === events) return;
  watchedStorage = events;
  events.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const { oldValue = {}, newValue = {} } = changes.settings;
    for (const provider of REMOTE_PROVIDER_IDS) {
      const consentRevoked =
        oldValue[`${provider}Consent`] === true &&
        newValue[`${provider}Consent`] !== true;
      const keyChanged =
        oldValue[`${provider}ApiKey`] !== newValue[`${provider}ApiKey`];
      if (consentRevoked || keyChanged) {
        for (const subscriber of listeners) {
          subscriber(provider, { consentRevoked, keyChanged });
        }
      }
      if (
        consentRevoked ||
        keyChanged ||
        ["GenerationConsent", "GenerationRevision", "Model"].some(
          (suffix) =>
            oldValue[`${provider}${suffix}`] !==
            newValue[`${provider}${suffix}`],
        )
      ) {
        for (const subscriber of generationListeners) subscriber(provider);
      }
    }
  });
}
