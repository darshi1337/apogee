import { isSensitiveUrl } from "../storage/pageCache.js";

let enabled = false;

export function setDebugLogging(on) {
  enabled = on === true;
}

export function debugLog(...args) {
  if (enabled) console.log(...args);
}

export async function initDebugLogging() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    setDebugLogging(settings?.debugLogs === true);
  } catch {}
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    setDebugLogging(changes.settings.newValue?.debugLogs === true);
  });
}

const MAX_LOG_MESSAGE_LENGTH = 500;

// True when an `extra` / log key names a credential. CamelCase, snake_case,
// kebab-case and dotted forms are normalized to words first, so bare `auth`
// matches `myAuth` / `my-auth` but not `author`.
export function isSensitiveCredentialKey(key) {
  const normalized = String(key ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  return /\b(api key|apikey|access token|accesstoken|auth token|authtoken|authorization|auth|basic auth|secret|password|passwd|pwd|private key|privatekey|client secret|clientsecret|token|key)\b/.test(
    normalized,
  );
}

export function sanitizeLogMessage(message, maxLen = MAX_LOG_MESSAGE_LENGTH) {
  let str = String(message ?? "");

  // 1. Redact Authorization Bearer tokens & secret/API keys, including JSON/YAML-style forms.
  str = str.replace(
    /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi,
    "Bearer [redacted-token]",
  );
  str = str.replace(
    /(["']?)([A-Za-z0-9_.$-]+)\1(\s*[:=]\s*)(["']?)([^\s,&"'<>}\]]+)\4/g,
    (match, quote, key, separator, valueQuote) => {
      if (!isSensitiveCredentialKey(key)) return match;
      return `${quote}${key}${quote}${separator}${valueQuote}[redacted]${valueQuote}`;
    },
  );

  // 2. Redact data: and blob: URLs
  str = str.replace(
    /data:[a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+;base64,[^\s"'<>()]+/gi,
    "data:[redacted-data-url]",
  );
  str = str.replace(/blob:[^\s"'<>()]+/gi, "blob:[redacted-blob-url]");

  // 3. Redact file: URLs
  str = str.replace(/file:\/\/[^\s"'<>()]+/gi, "file://[redacted-file-url]");

  // 4. Redact http / https URLs (credentials, query parameters, sensitive domains)
  str = str.replace(/https?:\/\/[^\s"'<>()]+/gi, (urlMatch) => {
    if (isSensitiveUrl(urlMatch)) {
      return "[redacted-sensitive-url]";
    }
    let sanitizedUrl = urlMatch;
    sanitizedUrl = sanitizedUrl.replace(
      /\/\/[^@\s]+@/,
      "//[redacted-credentials]@",
    );
    sanitizedUrl = sanitizedUrl.replace(/\?[^\s#]*/, "?[redacted-query]");
    return sanitizedUrl;
  });

  // 5. Truncate if length exceeds maxLen
  if (str.length > maxLen) {
    str = str.slice(0, maxLen) + "... [truncated]";
  }

  return str;
}
