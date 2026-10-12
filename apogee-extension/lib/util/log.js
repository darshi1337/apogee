import { isSensitiveUrl } from "../storage/pageCache.js";

let enabled = false;

function setDebugLogging(on) {
  enabled = on === true;
}

export function debugLog(...args) {
  if (enabled) console.log("[apogee]", ...args);
}

export async function initDebugLogging() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    setDebugLogging(settings?.debugLogs === true);
  } catch {
    // Keep debug logging off when settings cannot be read.
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    setDebugLogging(changes.settings.newValue?.debugLogs === true);
  });
}

const MAX_LOG_MESSAGE_LENGTH = 500;

// A key names a credential when its words match the allow-list below.
// CamelCase, snake_case, kebab-case and dotted forms are split first,
// so bare `auth` matches `myAuth` but not `author`.
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

  str = str.replace(
    /data:[a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+;base64,[^\s"'<>()]+/gi,
    "data:[redacted-data-url]",
  );
  str = str.replace(/blob:[^\s"'<>()]+/gi, "blob:[redacted-blob-url]");

  str = str.replace(/file:\/\/[^\s"'<>()]+/gi, "file://[redacted-file-url]");

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

  if (str.length > maxLen) {
    str = str.slice(0, maxLen) + "... [truncated]";
  }

  return str;
}
