// Nullable URL constructor for untrusted input: callers map null to
// their own fallback.
export function tryParseUrl(url, base) {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}
