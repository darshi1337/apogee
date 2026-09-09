// Canonical passage matcher. content/highlight.js imports this module and
// Vite bundles it into the injected content script, so this is the single
// source of truth for matching logic.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_MATCH_TEXT_CHARS = 1500;

function buildFlexibleMatcher(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_MATCH_TEXT_CHARS) return null;
  const escaped = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
  if (!escaped) return null;
  try {
    return new RegExp(escaped, "i");
  } catch {
    return null;
  }
}

function tryMatch(haystack, text) {
  const re = buildFlexibleMatcher(text);
  if (!re) return null;
  const match = re.exec(haystack);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function splitIntoSpans(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

const PREFIX_WINDOW_CHARS = 180;

export function findMatchingRange(pageText, chunkText) {
  const haystack = pageText || "";
  const needle = (chunkText || "").trim();
  if (!haystack || !needle) return null;

  const full = tryMatch(haystack, needle);
  if (full) return full;

  for (const span of splitIntoSpans(needle)) {
    const spanMatch = tryMatch(haystack, span);
    if (spanMatch) return spanMatch;
  }

  const prefix = needle.slice(0, PREFIX_WINDOW_CHARS);
  if (prefix.length < needle.length) {
    return tryMatch(haystack, prefix);
  }
  return null;
}
