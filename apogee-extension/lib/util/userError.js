// UserFacingError – an error whose message was written for the end user.
// Any error that is *not* a UserFacingError is assumed to carry a raw string
// from the browser, from a vendored library, or from a remote server, and
// `toUserMessage` maps it onto one of a small set of generic fallbacks so that
// those strings never reach the UI verbatim.
export class UserFacingError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "UserFacingError";
    // Marker so the check works across module‐graph duplicates.
    this.isUserFacing = true;
  }
}

// More specific patterns go first; the first match wins.

const FALLBACKS = [
  [/\bpdf\b/i, "Couldn't process this PDF document."],
  [
    /out of memory|oom|buffer allocation|gpubuffer|allocation failed|memory limit|exceeded max.*memory|wasm.*memory/i,
    "Memory limit reached while processing this document. Try a smaller model or reducing context size.",
  ],
  [
    /webgpu|offscreen|onnx|transformers\.js|model download/i,
    "In-browser model error. Try picking a different model in Settings.",
  ],
  [
    /ollama|could not connect/i,
    "Could not connect to Ollama. Make sure Ollama is running and check your Settings.",
  ],
  [
    /stream|connection.*(lost|drop)|port closed|message port/i,
    "Connection to the model was lost. Try summarizing again.",
  ],
  [
    /inject|content.?script|read.*page|extract/i,
    "Couldn't read this page. Try reloading it.",
  ],
];

const GENERIC_FALLBACK = "An unexpected error occurred. Try summarizing again.";

// Return a user‐safe message for any error.
// UserFacingError messages pass through verbatim; anything else matches
// FALLBACKS in order or falls back to generic. Pure with no browser APIs.
export function toUserMessage(err, fallback = GENERIC_FALLBACK) {
  if (err && err.isUserFacing) return err.message;

  const raw = String(err?.message ?? err ?? "");

  for (const [pattern, message] of FALLBACKS) {
    if (pattern.test(raw)) return message;
  }
  return fallback;
}

const MAX_NOTIFICATION_LEN = 120;
const SHORT_SUFFIX = " Open Apogee for details.";

// Cap the notification body so message plus suffix fits the limit.
export function formatNotificationMessage(
  rawMessage,
  suffix = " Click to see what this means.",
) {
  const full = `${rawMessage}${suffix}`;
  if (full.length <= MAX_NOTIFICATION_LEN) {
    return full;
  }
  const maxRawLen = MAX_NOTIFICATION_LEN - SHORT_SUFFIX.length - 3;
  const truncatedRaw = rawMessage.slice(0, maxRawLen).trimEnd() + "...";
  return `${truncatedRaw}${SHORT_SUFFIX}`;
}
