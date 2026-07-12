// Client-side text chunking for the in-browser WebLLM path.
// The small quantized models used in-browser (e.g. Qwen2.5-1.5B) have a few-K
// token context window. The backend already chunks long pages before feeding
// them to Ollama; the WebLLM path previously sent the entire page in a single
// prompt, which overflows the context on long articles (the model then throws
// or silently truncates the *front* of the prompt, dropping the instructions).
//
// Sizes are expressed in characters (~4 chars/token as a rough heuristic) so we
// don't need a tokenizer here. Values are deliberately conservative.

// Max characters of source content to feed into a single generation.
export const MAX_CHUNK_CHARS = 6000;

// When we can only send one prompt (ask / suggest-questions), hard cap the
// content so the prompt fits alongside the template and the reserved output.
export const MAX_SINGLE_PROMPT_CHARS = 8000;

// Split text into chunks of at most `maxChars`, preferring to break on
// paragraph, then sentence, then whitespace boundaries so we don't cut words.
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
    if (splitAt <= 0) splitAt = maxChars; // no good boundary — hard cut

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

// Truncate content to fit a single prompt, appending an ellipsis marker so the
// model knows the input was cut.
export function truncateForPrompt(text, maxChars = MAX_SINGLE_PROMPT_CHARS) {
  const clean = (text || "").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trim() + "\n\n[...content truncated...]";
}
