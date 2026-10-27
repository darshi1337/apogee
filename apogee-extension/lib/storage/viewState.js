import {
  clearIndexedKeys,
  estimateByteSize,
  evictKeysOverBudget,
  hashUrl,
  isQuotaError,
  shouldPersist,
} from "./pageCache.js";
import { createLock } from "../util/mutex.js";

function viewStateKey(tabId) {
  return `popupViewState:${tabId}`;
}

// Tab ids come from chrome.tabs and are non-negative integers. Anything else
// (null, undefined, a URL string, floats) must never become a storage key:
// `saveViewState(url, ...)` once created `popupViewState:https://...` keys
// that leaked raw URLs into key names, were unreachable via
// `loadViewState(tabId)`, and were never removed by `removeViewState(tabId)`
// on tab close.
export function isValidTabId(tabId) {
  return typeof tabId === "number" && Number.isInteger(tabId) && tabId >= 0;
}

export function isOrphanedViewStateKey(key) {
  return (
    typeof key === "string" &&
    key.startsWith("popupViewState:") &&
    !/^\d+$/.test(key.slice("popupViewState:".length))
  );
}

// Same value as MAX_CACHED_PAGES (pageCache.js) today, but not coupled to
// it: this caps per-tab UI state, that caps cached pages.
const MAX_VIEW_STATES = 50;
// View states duplicate summary text per tab, so they keep a smaller
// byte budget inside the quota.
const MAX_VIEW_STATE_BYTES = 1_000_000;

const acquireViewStateLock = createLock();

async function preparePartial(partial) {
  let scrubContent;
  if (partial.url) {
    const url = partial.url;
    scrubContent = !(await shouldPersist(url));
    partial = {
      ...partial,
      url: undefined,
      urlHash: await hashUrl(url),
    };
  } else {
    // Stream-start and finalize writes can merge content into an existing tab
    // state without repeating the URL. History-off still has to scrub page
    // content on those writes; shouldPersist("") applies the global policy
    // without inventing a page identity (sensitive/private hosts need a URL
    // and are handled by callers that have one).
    scrubContent = !(await shouldPersist(""));
  }
  return { partial, scrubContent };
}

async function writeViewState(tabId, partial, expectedJob = null) {
  if (!isValidTabId(tabId)) return null;
  const prepared = await preparePartial(partial);
  const release = await acquireViewStateLock();
  try {
    const key = viewStateKey(tabId);
    const { viewStateOrder = [], ...rest } = await chrome.storage.local.get([
      key,
      "viewStateOrder",
    ]);
    const current = rest[key] || {};
    if (
      expectedJob &&
      (current.jobId !== expectedJob.jobId ||
        (expectedJob.subview && current.subview !== expectedJob.subview))
    ) {
      return null;
    }
    const state = { ...current, ...prepared.partial };
    if (prepared.scrubContent) {
      delete state.question;
      delete state.answerText;
      delete state.summaryText;
      // Raw reader inputs are page content too. Keep promptsCacheKey: it is
      // already a hash-scoped identity, and without it a restored job could
      // not regenerate its suggested prompts.
      delete state.selectionText;
      delete state.focusKeyword;
    }

    const order = viewStateOrder.filter((k) => k !== key);
    order.push(key);
    const removeKeys = await evictKeysOverBudget(order, {
      maxCount: MAX_VIEW_STATES,
      maxBytes: MAX_VIEW_STATE_BYTES,
      extraBytes: estimateByteSize(state),
    });

    try {
      await chrome.storage.local.set({ [key]: state, viewStateOrder: order });
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      // Ephemeral UI state only: evict half the oldest states and retry
      // once, else drop the write with a warning.
      const extra = order.splice(0, Math.ceil(order.length / 2));
      removeKeys.push(...extra);
      try {
        await chrome.storage.local.set({ [key]: state, viewStateOrder: order });
      } catch (retryErr) {
        console.warn("View state dropped: browser storage is full.", retryErr);
        return null;
      }
    }
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
    return state;
  } finally {
    release();
  }
}

export function saveViewState(tabId, partial) {
  return writeViewState(tabId, partial);
}

export function saveViewStateIfJobMatches(
  tabId,
  jobId,
  partial,
  subview = null,
) {
  if (!jobId) return Promise.resolve(null);
  return writeViewState(tabId, partial, { jobId, subview });
}

export async function loadViewState(tabId) {
  if (!isValidTabId(tabId)) return null;
  const key = viewStateKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

// Test-only role (#500): names the storage keys that hold view state
// (popupViewState:<tabId> and the viewStateOrder index). No live caller -
// viewStateKey() and isOrphanedViewStateKey() cover the live paths - but the
// test pins the key contract those two rely on.
export function isViewStateKey(key) {
  return key.startsWith("popupViewState:") || key === "viewStateOrder";
}

// Delete every tab's saved view state. Reads only the index and its keys
// under the writer lock, so a concurrent write cannot resurrect entries.
export async function clearAllViewStates() {
  return clearIndexedKeys(acquireViewStateLock, ["viewStateOrder"]);
}

export async function removeViewState(tabId) {
  if (!isValidTabId(tabId)) return;
  const release = await acquireViewStateLock();
  try {
    const key = viewStateKey(tabId);
    const { viewStateOrder = [] } =
      await chrome.storage.local.get("viewStateOrder");
    const order = viewStateOrder.filter((k) => k !== key);
    await chrome.storage.local.set({ viewStateOrder: order });
    await chrome.storage.local.remove(key);
  } finally {
    release();
  }
}

// Remove legacy entries keyed by URL instead of tab id. Keeps one
// full-store scan since orphans are absent from the index; runs on tab
// close and startup, never on the write path.
export async function cleanupOrphanedViewStates() {
  const release = await acquireViewStateLock();
  try {
    const all = await chrome.storage.local.get(null);
    const orphanKeys = Object.keys(all).filter(isOrphanedViewStateKey);
    if (orphanKeys.length === 0) {
      const order = all.viewStateOrder;
      if (!Array.isArray(order)) return 0;
      const pruned = order.filter((k) => !isOrphanedViewStateKey(k));
      if (pruned.length !== order.length) {
        await chrome.storage.local.set({ viewStateOrder: pruned });
        return order.length - pruned.length;
      }
      return 0;
    }
    const order = Array.isArray(all.viewStateOrder)
      ? all.viewStateOrder.filter((k) => !orphanKeys.includes(k))
      : [];
    await chrome.storage.local.set({ viewStateOrder: order });
    await chrome.storage.local.remove(orphanKeys);
    return orphanKeys.length;
  } finally {
    release();
  }
}
