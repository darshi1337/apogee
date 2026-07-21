// Per-tab popup "what was on screen" state, shared by popup.js (reads it on
// every open to decide which view to restore) and background/service-worker.js
// (writes it when a context-menu/keyboard-shortcut-triggered summarize job
// starts, see runBackgroundSummarize, so opening the popup mid-job shows the
// loading/summarizing view and reattaches to the live stream, exactly like a
// popup-triggered summarize already does, instead of the default home page).
// Pure chrome.storage.local usage, no DOM/popup-only state.

import { hashUrl, shouldPersist } from "./pageCache.js";

function viewStateKey(tabId) {
  return `popupViewState:${tabId}`;
}

// Cap retained per-tab view states (each is keyed by tabId and can hold
// answer/summary text) with an oldest-first FIFO, like the other caches.
const MAX_VIEW_STATES = 50;

export async function saveViewState(tabId, partial) {
  if (tabId == null) return null;
  // Page-specific states carry a `url` (summary/answer/ask resume state);
  // pure app-navigation states (settings/home/contact) don't. Skip persisting
  // the former when the page isn't persistable, so private summaries/Q&A and
  // stream-resume pointers don't linger on disk. What does persist is only a
  // hash of the URL (same rationale as the hashed cache keys, see hashUrl):
  // it's needed solely for an equality check against the active tab on
  // restore, and the raw URL can carry session tokens in its query string.
  // Setting `url: undefined` also scrubs the raw copy older versions stored.
  if (partial.url) {
    if (!(await shouldPersist(partial.url))) return null;
    partial = { ...partial, url: undefined, urlHash: hashUrl(partial.url) };
  }
  const key = viewStateKey(tabId);
  const { viewStateOrder = [], ...rest } = await chrome.storage.local.get([
    key,
    "viewStateOrder",
  ]);
  const state = { ...(rest[key] || {}), ...partial };

  const order = viewStateOrder.filter((k) => k !== key);
  order.push(key);
  const removeKeys = [];
  while (order.length > MAX_VIEW_STATES) {
    removeKeys.push(order.shift());
  }

  await chrome.storage.local.set({ [key]: state, viewStateOrder: order });
  if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  return state;
}

export async function loadViewState(tabId) {
  if (tabId == null) return null;
  const key = viewStateKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}
