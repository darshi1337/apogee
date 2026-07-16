import { chunkText } from "./chunkService.js";
import { buildSummaryPrompt } from "./promptService.js";
import { generateStream, LLMError } from "./llmService.js";
import { cleanText } from "../utils/cleaner.js";

// Matches a bullet marker (•, -, *) or a numbered-list marker (1. / 1)) at
// the start of a line. Models sometimes number their bullets instead of
// using a symbol marker; treating only symbol markers as bullets silently
// dropped every line of output from those responses.
const BULLET_LINE = /^(?:[•\-*]|\d+[.)])/;

// Upper bound on how many chunks (== sequential model calls) a single summary
// may fan out into. A 500KB page at the 5KB default chunk size would otherwise
// become ~100 sequential Ollama calls, hours of work on a CPU backend. When a
// page exceeds this, it's re-chunked at a larger target size so every chunk is
// still summarized (no content dropped), just in fewer, larger passes.
export const MAX_CHUNKS = 12;

/**
 * Async-generator yielding summary tokens; the route streams this as the
 * response body. `chunkTextFn`/`generateStreamFn` are injectable seams for
 * tests, production callers never need to pass them. `signal` cancels the
 * underlying model calls when the HTTP client disconnects.
 */
export async function* summarizeText(
  { text, title, url, mode, model, signal },
  { chunkTextFn = chunkText, generateStreamFn = generateStream } = {},
) {
  const cleanedContent = cleanText(text);
  let chunks = chunkTextFn(cleanedContent);
  if (chunks.length > MAX_CHUNKS) {
    let biggerSize = Math.ceil(cleanedContent.length / MAX_CHUNKS);
    chunks = chunkTextFn(cleanedContent, biggerSize);
    // A single re-chunk pass isn't always enough: chunkText breaks at
    // sentence boundaries, so text made of consistently long sentences can
    // still pack only ~1 sentence per chunk at the new target size and blow
    // past MAX_CHUNKS again. Keep growing until the bound actually holds,
    // this is guaranteed to terminate, since chunkText collapses to a
    // single chunk once the target size triples past the whole text length.
    while (chunks.length > MAX_CHUNKS) {
      biggerSize *= 2;
      chunks = chunkTextFn(cleanedContent, biggerSize);
    }
  }

  try {
    // --- Single chunk: stream tokens directly ---
    if (chunks.length === 1) {
      const prompt = buildSummaryPrompt({
        title,
        url,
        content: chunks[0],
        mode,
      });
      yield* generateStreamFn(prompt, model, { signal });
      return;
    }

    // Bullets: emit each chunk's bullets as it finishes so output starts
    // flowing immediately instead of after every chunk.
    if (mode === "bullets") {
      for (const chunk of chunks) {
        const prompt = buildSummaryPrompt({ title, url, content: chunk, mode });
        let lineBuffer = "";
        for await (const token of generateStreamFn(prompt, model, { signal })) {
          lineBuffer += token;
          let newlineIndex;
          while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
            const line = lineBuffer.slice(0, newlineIndex);
            lineBuffer = lineBuffer.slice(newlineIndex + 1);
            const lineStripped = line.trim();
            if (BULLET_LINE.test(lineStripped)) {
              yield lineStripped + "\n";
            }
          }
        }
        if (lineBuffer) {
          const lineStripped = lineBuffer.trim();
          if (BULLET_LINE.test(lineStripped)) {
            yield lineStripped + "\n";
          }
        }
      }
      return;
    }

    // Sentences/paragraphs: summarize every chunk, then merge.
    const chunkSummaries = [];
    for (const chunk of chunks) {
      const prompt = buildSummaryPrompt({ title, url, content: chunk, mode });
      let partial = "";
      for await (const token of generateStreamFn(prompt, model, { signal })) {
        partial += token;
      }
      chunkSummaries.push(partial.trim());
    }

    const combinedText = chunkSummaries.join("\n");
    const mergePrompt = buildSummaryPrompt({
      title,
      url,
      content: combinedText,
      mode,
    });
    yield* generateStreamFn(mergePrompt, model, { signal });
  } catch (err) {
    // Raised mid-stream, after the 200 response headers are sent, so we
    // can't set an error status, surface it in the body instead.
    if (err instanceof LLMError) {
      yield `\n\n[Error: ${err.message}]`;
      return;
    }
    throw err;
  }
}
