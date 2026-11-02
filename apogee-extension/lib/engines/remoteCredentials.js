import { REMOTE_PROVIDER_IDS } from "./remoteModels.js";

const listeners = new Set();
let watchedStorage;

// Shared chrome.storage.onChanged subscription for remote credential changes.
// Subscribers are notified once per affected provider, in registration order.
export function onRemoteCredentialChange(listener) {
  const events = chrome.storage.onChanged;
  if (!events?.addListener) return;
  listeners.add(listener);
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
    }
  });
}