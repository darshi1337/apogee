// Shared suggested-questions parsing for the WebLLM offscreen engine
// (offscreen.js). Extracted out of offscreen.js so it's directly
// unit-testable, the previous test suite exercised a copy-pasted
// duplicate of this logic instead of the real code path, which let the two
// silently drift.

// Matches one bullet marker (-, *, •) or one numbered-list marker (N. / N))
// at the start of a line. Requires the digits to be followed by "." or ")"
//, a plain `\d` in the character class (the old version of this regex)
// would strip the leading digits off a legitimate question like
// "2025 predictions?" too, since bare digits alone satisfied it.
const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s*/;

/** Strips list markers repeatedly, so a compound prefix like "- 1. " is fully removed. */
function stripListMarkers(line) {
  let cleaned = line.trim();
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(LIST_MARKER, "").trim();
  } while (cleaned !== previous);
  return cleaned;
}

/**
 * Parses a model's raw suggested-questions response into up to two
 * questions: strips <think>...</think> reasoning blocks (and an unterminated
 * one running to the end of the text), then list markers, keeping only
 * lines that end in "?".
 */
export function parseSuggestedQuestions(text) {
  const withoutThinking = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "");

  return withoutThinking
    .split("\n")
    .map((line) => stripListMarkers(line))
    .filter((line) => line.length > 0 && line.endsWith("?"))
    .slice(0, 2);
}
