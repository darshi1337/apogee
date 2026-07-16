import { chunkText } from "./chunkService.js";
import { buildSummaryPrompt } from "./promptService.js";
import { generateStream, LLMError } from "./llmService.js";
import { cleanText } from "../utils/cleaner.js";

const BULLET_PREFIXES = new Set(["•", "-", "*"]);

/**
 * Async-generator yielding summary tokens; the route streams this as the
 * response body. `chunkTextFn`/`generateStreamFn` are injectable seams for
 * tests — production callers never need to pass them.
 */
export async function* summarizeText(
  { text, title, url, mode, model },
  { chunkTextFn = chunkText, generateStreamFn = generateStream } = {},
) {
  const cleanedContent = cleanText(text);
  const chunks = chunkTextFn(cleanedContent);

  try {
    // --- Single chunk: stream tokens directly ---
    if (chunks.length === 1) {
      const prompt = buildSummaryPrompt({ title, url, content: chunks[0], mode });
      yield* generateStreamFn(prompt, model);
      return;
    }

    // Bullets: emit each chunk's bullets as it finishes so output starts
    // flowing immediately instead of after every chunk.
    if (mode === "bullets") {
      for (const chunk of chunks) {
        const prompt = buildSummaryPrompt({ title, url, content: chunk, mode });
        let lineBuffer = "";
        for await (const token of generateStreamFn(prompt, model)) {
          lineBuffer += token;
          let newlineIndex;
          while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
            const line = lineBuffer.slice(0, newlineIndex);
            lineBuffer = lineBuffer.slice(newlineIndex + 1);
            const lineStripped = line.trim();
            if (BULLET_PREFIXES.has(lineStripped[0])) {
              yield lineStripped + "\n";
            }
          }
        }
        if (lineBuffer) {
          const lineStripped = lineBuffer.trim();
          if (BULLET_PREFIXES.has(lineStripped[0])) {
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
      for await (const token of generateStreamFn(prompt, model)) {
        partial += token;
      }
      chunkSummaries.push(partial.trim());
    }

    const combinedText = chunkSummaries.join("\n");
    const mergePrompt = buildSummaryPrompt({ title, url, content: combinedText, mode });
    yield* generateStreamFn(mergePrompt, model);
  } catch (err) {
    // Raised mid-stream, after the 200 response headers are sent, so we
    // can't set an error status — surface it in the body instead.
    if (err instanceof LLMError) {
      yield `\n\n[Error: ${err.message}]`;
      return;
    }
    throw err;
  }
}
