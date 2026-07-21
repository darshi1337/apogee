// Cache-key derivation, storage read/write, and the "may this URL's data be
// persisted?" rule, shared by popup.js (UI-triggered summarize/ask) and
// background/service-worker.js (context-menu/keyboard-shortcut-triggered
// summarize, which runs with no popup open, see runBackgroundSummarize).
// Pure chrome.storage.local usage throughout, works identically in the
// service worker, the offscreen document, and the popup.

import { getSettings } from "./settings.js";

// Only the generic Readability-parsed extraction is expensive enough to be
// worth caching/reusing. Gmail and YouTube extractors are cheap DOM reads,
// and, unlike a fresh page load, those sites navigate between threads/
// videos via the History API, so a cached/reused result can go stale
// without `tab.url` necessarily changing in a way we'd catch. Always
// re-extract live for those instead of trusting any cache. PDFs have no
// `type` at all (see lib/pageExtraction.js), so they're never cacheable
// through this path either, their text comes from a separate pipeline.
export const CACHEABLE_PAGE_TYPES = new Set(["article", "generic"]);

// Hash the URL (cyrb53) so raw URLs, which can carry session tokens or reset
// links in their query strings, aren't left sitting in plaintext in storage,
// neither in keys (here) nor in stored values (see persistContent, which
// strips/hashes the URL before writing). Non-cryptographic, but wide enough
// to avoid collisions in the small bounded cache.
export function hashUrl(url) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function getSummaryCacheKey(url, fmt, model) {
  return `summary:${fmt}:${model}:${hashUrl(url)}`;
}
export function getPromptsCacheKey(url, fmt, model) {
  return `suggested-prompts:${fmt}:${model}:${hashUrl(url)}`;
}
// Extracted page content is independent of format/model, so it's cached
// separately and survives model switches and popup close/reopen, avoids
// re-scraping (a full Readability parse on generic pages) just to ask a
// follow-up question or regenerate a summary in a different format.
export function getContentCacheKey(url) {
  return `content:${hashUrl(url)}`;
}

// Cap how many pages we keep cached so storage doesn't grow without bound.
// `cacheOrder` is an insertion-ordered list of { s, p, t } entries used as a
// simple FIFO eviction index.
export const MAX_CACHED_PAGES = 50;

export async function persistSummary(cacheKey, promptsCacheKey, text, title) {
  const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
  const order = cacheOrder.filter((e) => e && e.s !== cacheKey);
  // `t` (title) rides along on the FIFO index entry itself rather than
  // changing the cacheKey's own stored value from a plain string to an
  // object: the URL is already deliberately not stored anywhere here (see
  // getSummaryCacheKey's hashing), so a title is the only human-readable
  // way to tell entries apart in the Past Summaries list. Older entries
  // written before this field existed just have `t: undefined`, read back
  // as "no title", not a breaking format change.
  order.push({ s: cacheKey, p: promptsCacheKey, t: title || "" });

  const removeKeys = [];
  while (order.length > MAX_CACHED_PAGES) {
    const old = order.shift();
    if (old?.s) removeKeys.push(old.s);
    if (old?.p) removeKeys.push(old.p);
  }

  await chrome.storage.local.set({ [cacheKey]: text, cacheOrder: order });
  if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
}

// Extracted content is cached separately (keyed only by URL, see
// getContentCacheKey) so it outlives format/model switches and popup
// close/reopen, re-asking a question or regenerating a summary in a
// different format shouldn't require re-scraping the page.
export async function persistContent(url, pageData) {
  const contentKey = getContentCacheKey(url);
  const { contentCacheOrder = [] } =
    await chrome.storage.local.get("contentCacheOrder");
  const order = contentCacheOrder.filter((k) => k !== contentKey);
  order.push(contentKey);

  const removeKeys = [];
  while (order.length > MAX_CACHED_PAGES) {
    removeKeys.push(order.shift());
  }

  // Strip the raw URL from the persisted copy: the key already encodes it
  // (hashed, see getContentCacheKey), getCachedContent() re-attaches it at
  // read time, and the raw form can carry session tokens in its query
  // string, hashing the key bought nothing while a plaintext copy sat in
  // the value.
  const persistable = { ...pageData };
  delete persistable.url;

  await chrome.storage.local.set({
    [contentKey]: persistable,
    contentCacheOrder: order,
  });
  if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
}

export async function getCachedContent(url) {
  const contentKey = getContentCacheKey(url);
  const stored = await chrome.storage.local.get(contentKey);
  if (!stored[contentKey]) return null;
  // Re-attach the URL persistContent stripped; the lookup key is derived
  // from it, so this is the same URL the entry was stored under.
  return { ...stored[contentKey], url };
}

// Hosts whose pages routinely contain private content (email, messaging).
// Their summaries and Q&A are never persisted to disk, regardless of the
// saveHistory setting, see shouldPersist.
const SENSITIVE_HOST_PATTERNS = [
  /(^|\.)mail\.google\.com$/,
  /(^|\.)outlook\.(live|office|office365)\.com$/,
  /(^|\.)mail\.proton\.me$/,
  /(^|\.)mail\.yahoo\.com$/,
  /(^|\.)messages\.google\.com$/,
  /(^|\.)web\.whatsapp\.com$/,
  /(^|\.)web\.telegram\.org$/,
  /(^|\.)app\.slack\.com$/,
  /(^|\.)discord\.com$/,
  /(^|\.)teams\.microsoft\.com$/,
  /(^|\.)teams\.live\.com$/,
];

export function isSensitiveUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SENSITIVE_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

// Whether page-derived data for this URL may be written to disk.
export async function shouldPersist(url) {
  if (isSensitiveUrl(url)) return false;
  const settings = await getSettings();
  return settings.saveHistory !== false;
}
