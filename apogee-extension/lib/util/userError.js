/**
 * UserFacingError – an error whose message was written for the end user.
 *
 * Any error that is *not* a UserFacingError is assumed to carry a raw string
 * from the browser, from a vendored library, or from a remote server, and
 * `toUserMessage` maps it onto one of a small set of generic fallbacks so that
 * those strings never reach the UI verbatim.
 */
export class UserFacingError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "UserFacingError";
    /** Marker so the check works across module‐graph duplicates. */
    this.isUserFacing = true;
  }
}

// ── Fallback catalogue ───────────────────────────────────────────────── Each entry is [pattern, fallback message]. Order matters: more specific patterns go first, broader ones later.

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

/**
 * Return a user‐safe message string for any error.
 *
 * - If `err` is a `UserFacingError` (or carries the `isUserFacing` marker),
 *   its `.message` is returned verbatim — someone already chose those words.
 * - Otherwise, the raw message is matched against `FALLBACKS` and replaced
 *   with the first hit, or with a generic fallback if nothing matches.
 *
 * The original error is always preserved on `cause` by callers and in the
 * `console.error` calls that sit beside every render site.
 *
 * This function is pure and needs no browser APIs, so its tests do not
 * require a `chrome` stub.
 */
export function toUserMessage(err) {
  if (err && err.isUserFacing) return err.message;

  const raw = String(err?.message ?? err ?? "");

  for (const [pattern, fallback] of FALLBACKS) {
    if (pattern.test(raw)) return fallback;
  }
  return GENERIC_FALLBACK;
}
