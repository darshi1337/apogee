export const DEFAULT_API_BASE = "http://127.0.0.1:8000";

const FALSY_ENV_VALUES = new Set(["0", "false", "no", "off"]);

export function allowLocalPdfAccess() {
  const value = (process.env.APOGEE_ALLOW_LOCAL_PDFS ?? "1")
    .trim()
    .toLowerCase();
  return !FALSY_ENV_VALUES.has(value);
}

// NOTE: this can't be pinned to Apogee's exact extension ID from here,
// Chrome assigns that ID at Web Store publish time and Firefox randomizes
// moz-extension:// UUIDs per profile, so it's shape-matched instead
// (32 a-p chars for Chrome, a UUID for Firefox) rather than left as a bare
// wildcard. This still permits *any* installed extension whose origin
// happens to match that shape, which is why CORS alone isn't relied on for
// protection, see the X-Apogee-Client header check in src/app.js, and the
// narrowed local PDF roots in src/routes/pdf.js.
//
// Loopback origins (http://127.0.0.1, http://localhost) are deliberately NOT
// allowed by default: the extension talks to the backend from its
// chrome-extension://` / moz-extension:// origin, never from a localhost page.
// Allowing localhost pages would let any local dev server or local app read
// the user's PDFs / drive summaries against their machine. Opt back in via
// APOGEE_CORS_ORIGIN_REGEX only if you have a localhost web client that needs it.
const DEFAULT_CORS_ORIGIN_REGEX =
  "^(chrome-extension://[a-p]{32}|" +
  "moz-extension://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$";

// Guards against an operator-supplied APOGEE_CORS_ORIGIN_REGEX that isn't
// anchored, e.g. "chrome-extension://[a-p]{32}" without ^...$ would
// substring-match and let any origin *containing* that pattern through
// RegExp#test, not just origins matching it exactly. Left alone if already
// anchored.
function ensureAnchored(pattern) {
  if (pattern.startsWith("^") && pattern.endsWith("$")) return pattern;
  return `^(?:${pattern})$`;
}

export function getCorsOriginRegex() {
  const custom = process.env.APOGEE_CORS_ORIGIN_REGEX;
  return custom === undefined
    ? DEFAULT_CORS_ORIGIN_REGEX
    : ensureAnchored(custom);
}

export function getOllamaHealthTimeout() {
  const trimmed = (process.env.APOGEE_OLLAMA_HEALTH_TIMEOUT ?? "").trim();
  if (trimmed === "") return 3.0;
  const raw = Number(trimmed);
  return Number.isFinite(raw) ? raw : 3.0;
}

// Mirrors the Ollama CLI/Python client's OLLAMA_HOST support. The `ollama`
// npm package's default export doesn't read this env var itself (unlike
// Python's client), every caller must build its own Client with an
// explicit `host`, falling back to the package's own default when unset.
export function getOllamaHost() {
  const trimmed = (process.env.OLLAMA_HOST ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

// How long Ollama keeps the model resident in memory after a request. On a
// CPU-only machine the cold-load between requests dominates latency, so
// keeping the model warm between summarize/ask calls is a big win. Accepts
// Ollama's duration syntax ("5m", "1h") or seconds as a number; "-1" pins it
// in memory indefinitely. Defaults to Ollama's own default of 5 minutes.
export function getKeepAlive() {
  return process.env.APOGEE_OLLAMA_KEEP_ALIVE ?? "5m";
}
