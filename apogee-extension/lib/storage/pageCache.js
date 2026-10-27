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

// Every input shaping the output belongs in the key, or a stale cached
// answer comes back and the change looks ignored. Legacy keys without an
// engine stay out of engine-aware lookups until eviction or wipe.
async function hashedSuffix(value, tag) {
  // Inputs crossing a message or storage boundary can be the wrong type; a
  // non-string must not throw while building a key (or silently scope one).
  const extra = typeof value === "string" ? value.trim() : "";
  if (!extra) return "";
  return `:${tag}${(await sha256Hex(extra)).slice(0, 12)}`;
}

function translationEngineKey(translationEngine = TRANSLATION_ENGINES.OPUS) {
  return translationEngine === TRANSLATION_ENGINES.OPUS
    ? TRANSLATION_ENGINES.OPUS
    : TRANSLATION_ENGINES.LLM;
}

// One shared core for both cache keys; only the leading prefix differs.
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
  // An empty `fmt` leaves the segment out for callers whose key has no format
  // dimension. Summaries and suggested prompts both pass one.
  const head = fmt ? `${prefix}:${fmt}` : prefix;
  return `${head}:${lang}:${model}:${translationEngineKey(translationEngine)}:${await hashUrl(url)}${await hashedSuffix(customInstructions, "i")}${await hashedSuffix(focusKeyword, "k")}`;
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

// Inverse of the cache key for display: best-effort, with trailing
// segments stripped from the end since models may contain colons.
// The URL hash is one-way and unrecoverable.
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
// The suggested-questions key carries what the questions actually depend on:
// the page, the model, the language they are written in, the translation engine,
// the response format that shaped the summary text, the reader's own
// instructions and their focus keyword. The prompt embeds the formatted
// summary, so a format change can change the questions (#498).
// Provider, page type, and a hash of the selected text scope pages that share a
// URL; selection text itself never appears in the key.
export async function getPromptsCacheKey(
  url,
  model,
  lang = "auto",
  customInstructions = "",
  translationEngine = TRANSLATION_ENGINES.OPUS,
  focusKeyword = "",
  context = {},
) {
  const responseFormat =
    typeof context.responseFormat === "string" ? context.responseFormat : "";
  const baseKey = await makeCacheKey(
    "suggested-prompts",
    url,
    responseFormat,
    model,
    lang,
    customInstructions,
    translationEngine,
    focusKeyword,
  );

  const provider =
    typeof context.providerType === "string" ? context.providerType : "";
  const pageType = typeof context.pageType === "string" ? context.pageType : "";
  // A selection hash only means anything alongside the "selection" page type.
  // Keeping the two together stops a stray selectionText from fragmenting a
  // normal page's key.
  const selection =
    pageType === "selection"
      ? await hashedSuffix(context.selectionText, "s")
      : "";

  // Preserve the existing key format for callers that supply no context.
  if (!provider && !pageType && !selection) return baseKey;

  return `${baseKey}:p${provider}:t${pageType}${selection}`;
}
// Focus keywords are untrusted: only real strings scope the key (#392).
export function asFocusKeyword(value) {
  return typeof value === "string" ? value : "";
}
// Single choke point for the prompts key (#392): new dimensions go here,
// or partial call-site updates silently collide.
export async function getPromptsCacheKeyForSettings(
  url,
  settings,
  model,
  focusKeyword = "",
  context = {},
) {
  return getPromptsCacheKey(
    url,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
    focusKeyword,
    { ...context, responseFormat: settings.responseFormat },
  );
}
export async function getContentCacheKey(url) {
  return `content:${await hashUrl(url)}`;
}
export async function getSummaryCacheKeyForSettings(
  url,
  settings,
  model,
  focusKeyword = "",
) {
  return getSummaryCacheKey(
    url,
    settings.responseFormat,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
    focusKeyword,
  );
}

// Same value as MAX_VIEW_STATES (viewState.js) today, but not coupled to it.
export const MAX_CACHED_PAGES = 50;
// Byte budgets keep a few large summaries inside the storage quota.
// Sizes ride on the order index, so eviction skips value reads;
// legacy entries without sizes use native accounting when available.
export const MAX_CACHE_BYTES = 4_000_000;
const MAX_CONTENT_CACHE_BYTES = 2_000_000;
// 2.5 MB leaves headroom for non-Latin text plus index metadata.
export const MAX_ENTRY_BYTES = 2_500_000;

// Thrown when a write fails because browser storage is full. The message is safe to show the user.
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

// Best-effort UTF-8 byte length of a value as stored (JSON for non-strings).
export function estimateByteSize(value) {
  try {
    const s = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    return new TextEncoder().encode(s).length;
  } catch {
    return 0;
  }
}

// Native byte accounting when available, else null for index estimates.
// Never throws.
async function storedBytesInUse(keys) {
  try {
    const store = chrome?.storage?.local;
    const fn = store?.getBytesInUse;
    if (typeof fn !== "function") return null;
    const bytes =
      keys === undefined ? await fn.call(store) : await fn.call(store, keys);
    if (typeof bytes === "number" && Number.isFinite(bytes)) return bytes;
  } catch {
    // Best-effort estimate only; null when unsupported.
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
      // Surface quota-full visibly with retryable text instead of silent loss.
      if (isQuotaError(err)) throw new StorageQuotaError();
      throw err;
    }
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  } finally {
    release();
  }
}

// Evict oldest-first to fit count and byte caps. New entries carry sizes,
// so no value reads are needed.
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
  // The entry just written is always kept, even over budget.
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

// Oldest-first eviction for plain key lists. Fits the count cap always and
// the byte budget when native sizes exist. The new entry is always kept.
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

// Shared wipe core: delete every key named by the indexes plus the indexes.
// Reads only those keys under the writer lock, so concurrent writes cannot
// resurrect entries. Settings are left alone.
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
    // Test fakes return missing keys as undefined instead of omitting them.
    const existing = keys.filter((k) => stored[k] !== undefined);
    if (existing.length > 0) await chrome.storage.local.remove(existing);
    return existing.length;
  } finally {
    release();
  }
}

// Delete one saved summary and its index entry under one lock, so a
// concurrent write cannot orphan or resurrect it. True when removed.
export async function removeCachedSummary(cacheKey) {
  if (!cacheKey) return false;
  const release = await acquireIndexLock();
  try {
    const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
    const entry = cacheOrder.find((e) => e && e.s === cacheKey);
    if (!entry) return false;
    const removeKeys = [entry.s, entry.p].filter(Boolean);
    const updated = cacheOrder.filter((e) => e && e.s !== cacheKey);
    // Index first, so readers never see it point at deleted keys.
    await chrome.storage.local.set({ cacheOrder: updated });
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
    return true;
  } finally {
    release();
  }
}

// Delete all cached summaries and page content. Settings stay.
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

// The built-in list cannot cover every private host, so users name their
// own. Entries tolerate pasted urls, "*.", "www.", and mixed separators.
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
  // A named host covers its subdomains, like the built-in patterns.
  return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

// Whether a url is private. Pass cached settings to skip a second read.
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

// Write a finished summary unless it stopped being persistable mid-run.
// The persist decision is retaken here because history may have been
// turned off while the job ran.
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
