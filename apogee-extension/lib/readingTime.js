// Powers the "~4 min saved" badge shown next to a finished summary. Purely a
// local word-count estimate (average adult silent-reading speed), nothing
// here talks to a model or a server.
const AVERAGE_READING_WPM = 225;

function countWords(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Returns null when there isn't enough of a gap to be worth bragging about
// (near-empty original, or a summary that isn't meaningfully shorter), so
// callers can hide the badge entirely rather than show "~0 min saved".
export function formatTimeSaved(originalText, summaryText) {
  const originalWords = countWords(originalText);
  const summaryWords = countWords(summaryText);
  const savedMinutes = (originalWords - summaryWords) / AVERAGE_READING_WPM;

  if (savedMinutes < 0.5) return null;

  const savedSeconds = Math.round(savedMinutes * 60);
  if (savedSeconds < 60) {
    return `~${savedSeconds}s saved`;
  }
  return `~${Math.round(savedMinutes)} min saved`;
}
