import { getSettings } from "./settings.js";
import { TRANSLATION_ENGINES } from "../constants.js";
import { sha256Hex } from "../util/hash.js";
import { createLock } from "../util/mutex.js";
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
async function instructionsSuffix(customInstructions) {
  const extra = (customInstructions || "").trim();
  if (!extra) return "";
  return `:i${(await sha256Hex(extra)).slice(0, 12)}`;
}

function translationEngineKey(translationEngine = TRANSLATION_ENGINES.OPUS) {
  return translationEngine === TRANSLATION_ENGINES.OPUS
    ? TRANSLATION_ENGINES.OPUS
    : TRANSLATION_ENGINES.LLM;
}

export async function getSummaryCacheKey(
  url,
  fmt,
  model,
  lang = "auto",
  customInstructions = "",
  translationEngine = TRANSLATION_ENGINES.OPUS,
) {
  return `summary:${fmt}:${lang}:${model}:${translationEngineKey(translationEngine)}:${await hashUrl(url)}${await instructionsSuffix(customInstructions)}`;
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
) {
  return `suggested-prompts:${fmt}:${lang}:${model}:${translationEngineKey(translationEngine)}:${await hashUrl(url)}${await instructionsSuffix(customInstructions)}`;
}
export async function getContentCacheKey(url) {
  return `content:${await hashUrl(url)}`;
}

export const MAX_CACHED_PAGES = 50;

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
    order.push(entry);

    const removeKeys = [];
    while (order.length > MAX_CACHED_PAGES) {
      const old = order.shift();
      if (old?.s) removeKeys.push(old.s);
      if (old?.p) removeKeys.push(old.p);
    }

    await chrome.storage.local.set({ [cacheKey]: text, cacheOrder: order });
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  } finally {
    release();
  }
}

export async function persistContent(url, pageData) {
  const release = await acquireIndexLock();
  try {
    const contentKey = await getContentCacheKey(url);
    const { contentCacheOrder = [] } =
      await chrome.storage.local.get("contentCacheOrder");
    const order = contentCacheOrder.filter((k) => k !== contentKey);
    order.push(contentKey);

    const removeKeys = [];
    while (order.length > MAX_CACHED_PAGES) {
      removeKeys.push(order.shift());
    }

    const persistable = { ...pageData };
    delete persistable.url;

    await chrome.storage.local.set({
      [contentKey]: persistable,
      contentCacheOrder: order,
    });
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

const CACHED_PAGE_PREFIXES = ["summary:", "suggested-prompts:", "content:"];
const CACHED_PAGE_INDEX_KEYS = ["cacheOrder", "contentCacheOrder"];

/** Whether a storage key holds reading history rather than a setting. */
export function isCachedPageKey(key) {
  return (
    CACHED_PAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    CACHED_PAGE_INDEX_KEYS.includes(key)
  );
}

/**
 * Delete every cached summary, suggested-prompts list, and page content entry,
 * along with the two order indexes. Settings are left alone.
 *
 * This takes the same lock the writers do. Without it, a summary finishing at
 * the same moment would re-add its entry to a `cacheOrder` it read before the
 * wipe, leaving the list pointing at a key that no longer exists.
 */
export async function clearCachedPages() {
  const release = await acquireIndexLock();
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(isCachedPageKey);
    if (keys.length > 0) await chrome.storage.local.remove(keys);
    return keys.length;
  } finally {
    release();
  }
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
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SENSITIVE_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
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
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
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
