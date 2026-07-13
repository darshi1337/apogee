export const MAX_CHUNK_CHARS = 6000;

export const MAX_SINGLE_PROMPT_CHARS = 8000;

export function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const clean = (text || "").trim();
  if (clean.length <= maxChars) {
    return clean ? [clean] : [];
  }

  const chunks = [];
  let remaining = clean;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    let splitAt = window.lastIndexOf("\n\n");
    if (splitAt < maxChars * 0.5) splitAt = window.lastIndexOf(". ");
    if (splitAt < maxChars * 0.5) splitAt = window.lastIndexOf(" ");
    if (splitAt <= 0) splitAt = maxChars;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function truncateForPrompt(text, maxChars = MAX_SINGLE_PROMPT_CHARS) {
  const clean = (text || "").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trim() + "\n\n[...content truncated...]";
}
