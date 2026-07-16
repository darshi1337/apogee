export const DEFAULT_API_BASE = "http://127.0.0.1:8000";

export function allowLocalPdfAccess() {
  const value = (process.env.APOGEE_ALLOW_LOCAL_PDFS ?? "1").trim();
  return !["0", "false", "False"].includes(value);
}

// NOTE: this can't be pinned to Apogee's exact extension ID from here —
// Chrome assigns that ID at Web Store publish time and Firefox randomizes
// moz-extension:// UUIDs per profile — so it's shape-matched instead
// (32 a-p chars for Chrome, a UUID for Firefox) rather than left as a bare
// wildcard. This still permits *any* installed extension whose origin
// happens to match that shape, which is why CORS alone isn't relied on for
// protection — see the X-Apogee-Client header check in src/app.js, and the
// narrowed local PDF roots in src/routes/pdf.js.
const DEFAULT_CORS_ORIGIN_REGEX =
  "^(chrome-extension://[a-p]{32}|" +
  "moz-extension://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|" +
  "http://127\\.0\\.0\\.1(:\\d+)?|http://localhost(:\\d+)?)$";

export function getCorsOriginRegex() {
  return process.env.APOGEE_CORS_ORIGIN_REGEX ?? DEFAULT_CORS_ORIGIN_REGEX;
}

export function getOllamaHealthTimeout() {
  const raw = Number(process.env.APOGEE_OLLAMA_HEALTH_TIMEOUT ?? "3");
  return Number.isFinite(raw) ? raw : 3.0;
}
