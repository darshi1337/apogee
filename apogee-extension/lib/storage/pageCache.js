import { getSettings } from "./settings.js";
import { TRANSLATION_ENGINES } from "../constants.js";
import { sha256Hex } from "../util/hash.js";
import { createLock } from "../util/mutex.js";
import { tryParseUrl } from "../util/url.js";
import { embedTexts as defaultEmbedTexts } from "../engines/embeddings.js";

const acquireIndexLock = createLock();

export const CACHEABLE_PAGE_TYPES = new Set([
  "article",
  "generic",
  "wikipedia",
  "multi-tab",
]);

export async function hashUrl(url) {
  return sha256Hex(url);
}

// Everything that changes the generated text has to be part of the key, or a cached answer from the old settings comes back and the change looks ignored. That means the url, the response format, the model, the output language, and the custom instructions, and the translation engine. Anything else that starts shaping the output belongs here too.
//
// Legacy keys do not identify their translation engine and cannot safely be assigned to either one, so engine-aware lookups intentionally do not reuse them. They remain available in history until normal eviction or a cache wipe.
async function hashedSuffix(value, tag) {
  const extra = (value || "").trim();
  if (!extra) return "";
  return `:${tag}${(await sha256Hex(extra)).slice(0, 12)}`;
}

function translationEngineKey(translationEngine = TRANSLATION_ENGINES.OPUS) {
  return translationEngine === TRANSLATION_ENGINES.OPUS
    ? TRANSLATION_ENGINES.OPUS
    : TRANSLATION_ENGINES.LLM;
}

// Shared core for the summary/prompts cache keys: identical segments, only
// the leading prefix differs.
async function makeCacheKey(
  prefix,
  url,
  fmt,
  model,
  lang,
  customInstructions,
  translationEngine,
  focusKeyword,
) {
  return `${prefix}:${fmt}:${lang}:${model}:${translationEngineKey(translationEngine)}:${await hashUrl(url)}${await hashedSuffix(customInstructions, "i")}${await hashedSuffix(focusKeyword, "k")}`;
}

export async function getSummaryCacheKey(
  url,
  fmt,
  model,
  lang = "auto",
  customInstructions = "",
  translationEngine = TRANSLATION_ENGINES.OPUS,
  focusKeyword = "",
) {
  return makeCacheKey(
    "summary",
    url,
    fmt,
    model,
    lang,
    customInstructions,
    translationEngine,
    focusKeyword,
  );
}

// Inverse of getSummaryCacheKey for display/export: pulls the response
// format, language, and model back out of a stored cache key. Best-effort —
// legacy or malformed keys yield empty strings. The model itself may contain
// colons (e.g. "qwen3:8b"), so the trailing segments (instructions suffix,
// url hash, engine) are stripped from the end rather than split positionally.
// The source URL is a one-way hash and is not recoverable.
export function parseSummaryCacheKey(cacheKey) {
  const fallback = { format: "", language: "", model: "" };
  if (typeof cacheKey !== "string" || !cacheKey.startsWith("summary:")) {
    return fallback;
  }
  const rest = cacheKey
    .replace(/:k[0-9a-f]{12}$/, "")
    .replace(/:i[0-9a-f]{12}$/, "")
    .replace(/:[0-9a-f]{32}$/, "")
    .replace(
      new RegExp(`:(${TRANSLATION_ENGINES.OPUS}|${TRANSLATION_ENGINES.LLM})$`),
      "",
    )
    .replace(/^summary:/, "");
  const [format = "", language = "", ...modelParts] = rest.split(":");
  if (!format || !language || modelParts.length === 0) return fallback;
  return { format, language, model: modelParts.join(":") };
}
export async function getPromptsCacheKey(
  url,
  fmt,
  model,
  lang = "auto",
  customInstructions = "",
  translationEngine = TRANSLATION_ENGINES.OPUS,
  focusKeyword = "",
) {
  return makeCacheKey(
    "suggested-prompts",
    url,
    fmt,
    model,
    lang,
    customInstructions,
    translationEngine,
    focusKeyword,
  );
}
export async function getContentCacheKey(url) {
  return `content:${await hashUrl(url)}`;
}

export const MAX_CACHED_PAGES = 50;
// Byte budgets keep a few multi-MB summaries from blowing the ~10 MB
// chrome.storage.local quota while 50 tiny entries are kept. Sizes ride on
// the order index (`b`: bytes), so eviction never reads every value back.
// Legacy entries without `b` are measured with getBytesInUse when the
// browser offers it, else only the count cap applies.
export const MAX_CACHE_BYTES = 4_000_000;
const MAX_CONTENT_CACHE_BYTES = 2_000_000;
// A finished summary is capped at 1M chars upstream; 2.5 MB of UTF-8 leaves
// headroom for non-Latin text plus the order-entry metadata.
export const MAX_ENTRY_BYTES = 2_500_000;

/** Thrown when a write fails because browser storage is full. The message is safe to show the user. */
export class StorageQuotaError extends Error {
  constructor(
    message = "Browser storage is full, so this summary was not saved. Delete old summaries or clear cached data, then try again.",
  ) {
    super(message);
    this.name = "StorageQuotaError";
  }
}

export function isQuotaError(err) {
  if (!err) return false;
  if (err instanceof StorageQuotaError) return true;
  if (err?.name === "QuotaExceededError") return true;
  return /quota/i.test(err?.message || "");
}

/** Best-effort UTF-8 byte length of a value as stored (JSON for non-strings). */
export function estimateByteSize(value) {
  try {
    const s = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    return new TextEncoder().encode(s).length;
  } catch {
    return 0;
  }
}

// Native byte accounting when the browser offers it, else null so callers
// fall back to index estimates. Never throws: tests and some browsers lack it.
async function storedBytesInUse(keys) {
  try {
    const store = chrome?.storage?.local;
    const fn = store?.getBytesInUse;
    if (typeof fn !== "function") return null;
    const bytes =
      keys === undefined ? await fn.call(store) : await fn.call(store, keys);
    if (typeof bytes === "number" && Number.isFinite(bytes)) return bytes;
  } catch {
    // intent: best-effort usage estimate, return null if unsupported
  }
  return null;
}

const SENSITIVE_TITLE_PATTERNS = [
  /\b(inbox|gmail|outlook|protonmail|yahoo\s*mail|webmail)\b/i,
  /\b(messages|whatsapp|telegram|slack|discord|teams)\b/i,
  /\b(bank|banking|account\s*summary|statement|balance|paypal|stripe|transferwise|wise|fidelity|vanguard|chase|wells\s*fargo|capital\s*one|citi)\b/i,
  /\b(patient\s*portal|mychart|medical\s*record|lab\s*results|health\s*record)\b/i,
  /\b(password|login|sign\s*in|authentication|2fa|security\s*code|credentials)\b/i,
];

export function isSensitiveTitle(title) {
  if (!title || typeof title !== "string") return false;
  return SENSITIVE_TITLE_PATTERNS.some((re) => re.test(title));
}

export async function sanitizeTitleForStorage(title, options = {}) {
  if (!title || typeof title !== "string") return "";
  if (options.sensitive) return "";
  if (isSensitiveTitle(title)) return "";
  if (options.url && (await isPrivateUrl(options.url))) return "";
  return title.trim();
}

export async function persistSummary(
  cacheKey,
  promptsCacheKey,
  text,
  title,
  vector = null,
  options = {},
) {
  const { embedTextsFn = defaultEmbedTexts } =
    typeof options === "function" ? {} : options || {};
  const release = await acquireIndexLock();
  try {
    let v = vector;
    if (!v && embedTextsFn && typeof embedTextsFn === "function" && text) {
      try {
        const embs = await embedTextsFn([text]);
        if (Array.isArray(embs) && embs[0]) {
          v = Array.from(embs[0]);
        }
      } catch {
        v = null;
      }
    }

    const textBytes = estimateByteSize(text);
    if (textBytes > MAX_ENTRY_BYTES) {
      throw new StorageQuotaError(
        "That summary is too large for browser storage, so it was kept for this session only. Copy it out before closing the popup.",
      );
    }

    const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
    const order = cacheOrder
      .filter((e) => e && e.s !== cacheKey)
      .map((e) => {
        if (e && e.t && isSensitiveTitle(e.t)) {
          return { ...e, t: "" };
        }
        return e;
      });

    const safeTitle = await sanitizeTitleForStorage(title, options);
    const entry = { s: cacheKey, p: promptsCacheKey, t: safeTitle };
    if (v) entry.v = v;
    entry.b =
      textBytes + estimateByteSize(safeTitle) + (v ? estimateByteSize(v) : 0);
    order.push(entry);

    const removeKeys = await evictSummariesOverBudget(order);

    try {
      await chrome.storage.local.set({ [cacheKey]: text, cacheOrder: order });
    } catch (err) {
      // A quota-full disk must surface a message the user can act on, not a
      // silent loss: callers (e.g. finalize) show this text and keep the text
      // for retry.
      if (isQuotaError(err)) throw new StorageQuotaError();
      throw err;
    }
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  } finally {
    release();
  }
}

// Evict oldest-first until the order fits both the count cap and the byte
// budget. Returns the storage keys to delete. New entries carry `b`, so no
// value reads are needed; legacy entries without `b` are measured natively
// when possible, otherwise only the count cap applies.
async function evictSummariesOverBudget(order) {
  const legacyEntries = order.filter((e) => e && typeof e.b !== "number");
  let legacyBytes = 0;
  let bytesKnown = legacyEntries.length === 0;
  if (!bytesKnown) {
    const keys = [];
    for (const e of legacyEntries) {
      if (e.s) keys.push(e.s);
      if (e.p) keys.push(e.p);
    }
    const measured = await storedBytesInUse(keys);
    if (measured != null) {
      legacyBytes = measured;
      bytesKnown = true;
    }
  }
  const avgLegacy =
    legacyEntries.length > 0 && legacyBytes > 0
      ? legacyBytes / legacyEntries.length
      : 0;
  let total = legacyBytes;
  for (const e of order) total += typeof e?.b === "number" ? e.b : 0;

  const removeKeys = [];
  // The entry just written is always kept (length > 1): a single entry over
  // budget still stores, and the quota error below surfaces visibly.
  while (
    order.length > MAX_CACHED_PAGES ||
    (bytesKnown && total > MAX_CACHE_BYTES && order.length > 1)
  ) {
    const old = order.shift();
    if (!old) break;
    if (old?.s) removeKeys.push(old.s);
    if (old?.p) removeKeys.push(old.p);
    total -= typeof old?.b === "number" ? old.b : avgLegacy;
  }
  return removeKeys;
}

export async function persistContent(url, pageData) {
  const release = await acquireIndexLock();
  try {
    const contentKey = await getContentCacheKey(url);
    const { contentCacheOrder = [] } =
      await chrome.storage.local.get("contentCacheOrder");
    const order = contentCacheOrder.filter((k) => k !== contentKey);
    order.push(contentKey);

    const persistable = { ...pageData };
    delete persistable.url;

    // Byte-aware eviction without reading every value back.
    const removeKeys = await evictKeysOverBudget(order, {
      maxCount: MAX_CACHED_PAGES,
      maxBytes: MAX_CONTENT_CACHE_BYTES,
      extraBytes: estimateByteSize(persistable),
    });

    try {
      await chrome.storage.local.set({
        [contentKey]: persistable,
        contentCacheOrder: order,
      });
    } catch (err) {
      if (isQuotaError(err)) throw new StorageQuotaError();
      throw err;
    }
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  } finally {
    release();
  }
}

export async function getCachedContent(url) {
  const contentKey = await getContentCacheKey(url);
  const stored = await chrome.storage.local.get(contentKey);
  if (!stored[contentKey]) return null;
  return { ...stored[contentKey], url };
}

/**
 * Oldest-first eviction for plain key-list indexes (page content, view
 * states): fits the count cap always, and the byte budget when the browser
 * reports stored sizes natively. `extraBytes` sizes the entry about to be
 * written, without reading every value back. The entry just written is
 * always kept. Returns the keys to delete.
 */
export async function evictKeysOverBudget(
  order,
  { maxCount, maxBytes, extraBytes = 0 },
) {
  const removeKeys = [];
  const measured = await storedBytesInUse(order);
  if (measured != null) {
    let total = measured + extraBytes;
    const avg = order.length > 0 ? measured / order.length : 0;
    while (
      (order.length > maxCount || (total > maxBytes && order.length > 1)) &&
      order.length > 0
    ) {
      removeKeys.push(order.shift());
      total -= avg;
    }
  } else {
    while (order.length > maxCount) {
      removeKeys.push(order.shift());
    }
  }
  return removeKeys;
}

/**
 * Shared wipe core for clearCachedPages/clearAllViewStates: delete every key
 * named by the given order indexes, plus the indexes themselves. Handles
 * both entry-object indexes (cacheOrder) and plain key lists. Reads only
 * those indexes and the keys they name — never a full-store `get(null)`
 * scan — under the caller's writer lock, so a concurrent write cannot
 * resurrect entries into an index read before the wipe. Returns the number
 * of storage keys removed. Settings are left alone.
 */
export async function clearIndexedKeys(acquireLock, indexKeys) {
  const release = await acquireLock();
  try {
    const indexes = await chrome.storage.local.get(indexKeys);
    const keys = [];
    for (const name of indexKeys) {
      const entries = indexes[name];
      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (typeof e === "string") {
            if (e) keys.push(e);
          } else if (e) {
            if (e.s) keys.push(e.s);
            if (e.p) keys.push(e.p);
          }
        }
      }
      keys.push(name);
    }
    if (keys.length === 0) return 0;
    const stored = await chrome.storage.local.get(keys);
    // Real storage omits missing keys; some test fakes return them as
    // undefined, so absence means undefined here.
    const existing = keys.filter((k) => stored[k] !== undefined);
    if (existing.length > 0) await chrome.storage.local.remove(existing);
    return existing.length;
  } finally {
    release();
  }
}

/**
 * Delete one saved summary and its order-index entry as a single
 * read-modify-write under the page-cache lock, so a write landing between
 * the key delete and the index update cannot resurrect the entry or orphan
 * the keys. Best-effort across contexts (popup vs worker): chrome.storage
 * has no transactions, but one module-owned critical section replaces the
 * old two-step UI sequence. Returns true when anything was removed.
 */
export async function removeCachedSummary(cacheKey) {
  if (!cacheKey) return false;
  const release = await acquireIndexLock();
  try {
    const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
    const entry = cacheOrder.find((e) => e && e.s === cacheKey);
    if (!entry) return false;
    const removeKeys = [entry.s, entry.p].filter(Boolean);
    const updated = cacheOrder.filter((e) => e && e.s !== cacheKey);
    // Index first: a concurrent reader never sees the index point at keys
    // that are already gone.
    await chrome.storage.local.set({ cacheOrder: updated });
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
    return true;
  } finally {
    release();
  }
}

/**
 * Delete every cached summary, suggested-prompts list, and page content entry,
 * along with the two order indexes. Settings are left alone.
 */
export async function clearCachedPages() {
  return clearIndexedKeys(acquireIndexLock, [
    "cacheOrder",
    "contentCacheOrder",
  ]);
}

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
  const host = tryParseUrl(url)?.hostname.toLowerCase();
  if (!host) return false;
  return SENSITIVE_HOST_PATTERNS.some((re) => re.test(host));
}

// The list above is fixed, and it can only ever cover the webmail and chat hosts we thought of. A self-hosted mail server, a patient portal, or a company wiki is just as private to the person reading it, so they can name their own hosts. Entries are forgiving about how they are written: a pasted url, a leading "*.", "www.", a trailing slash, and separators of newline, comma, or space all normalize to a bare hostname.
export function parsePrivateHosts(raw) {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((entry) => {
      const trimmed = entry.trim().toLowerCase();
      if (!trimmed) return "";
      const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
      const hostOnly = withoutScheme.split(/[/?#]/)[0];
      return hostOnly.replace(/^\*\./, "").replace(/^www\./, "");
    })
    .filter((host) => host && host.includes("."));
}

export function matchesPrivateHost(url, rawHosts) {
  const hosts = parsePrivateHosts(rawHosts);
  if (hosts.length === 0) return false;
  const host = tryParseUrl(url)?.hostname.toLowerCase();
  if (!host) return false;
  // A named host covers its subdomains, so "example.com" also means "mail.example.com", the way the built-in patterns behave.
  return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Whether a url is private, by either the built-in list or the user's own.
 * Pass settings when the caller already has them, to avoid a second read.
 */
export async function isPrivateUrl(url, settings = null) {
  if (isSensitiveUrl(url)) return true;
  const resolved = settings || (await getSettings());
  return matchesPrivateHost(url, resolved.privateHosts);
}

export async function shouldPersist(url) {
  if (isSensitiveUrl(url)) return false;
  const settings = await getSettings();
  if (matchesPrivateHost(url, settings.privateHosts)) return false;
  return settings.saveHistory !== false;
}

/**
 * Write a finished summary, unless it stopped being persistable while it ran.
 *
 * A summary can take a minute, and the answer to `shouldPersist` from when the
 * job started is that stale by the time it lands. Someone who turns history off
 * mid-generation means the page in front of them most of all, so the decision is
 * taken again here, right before the write. Returns whether anything was saved.
 */
export async function persistSummaryIfAllowed(
  url,
  cacheKey,
  promptsCacheKey,
  text,
  title,
  vector = null,
  options = {},
) {
  if (!(await shouldPersist(url))) return false;
  await persistSummary(cacheKey, promptsCacheKey, text, title, vector, options);
  return true;
}
