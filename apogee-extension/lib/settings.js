// Shared settings read, used by popup.js (UI) and background/service-worker.js
// (background-triggered summarize jobs, see runBackgroundSummarize) so both
// read the same merged-with-defaults settings object. The write path
// (saveSettings) stays in popup.js, it's UI-only, nothing else writes settings.

import { DEFAULT_SETTINGS } from "./constants.js";

export async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}
