// Client-side port of apogee-backend/src/services/summaryService.js, driving
// ollamaClient.chatStream directly instead of relaying through the Node
// backend. Mirrors its chunking/map-reduce behavior so summaries look the
// same as they did under the old backend-relayed Local Ollama mode.

import { chunkText } from "./chunk.js";
import { buildSummaryPrompt } from "./prompts.js";
import { cleanText } from "./cleaner.js";
import { chatStream } from "./ollamaClient.js";

// Matches a bullet marker (•, -, *) or a numbered-list marker (1. / 1)) at
// the start of a line. Mirrors summaryService.js's BULLET_LINE.
const BULLET_LINE = /^(?:[•\-*]|\d+[.)])/;

// Upper bound on how many chunks (== sequential model calls) a single summary
// may fan out into, mirrors summaryService.js's MAX_CHUNKS.
export const MAX_CHUNKS = 12;

/**
 * Async-generator yielding summary tokens for the given text via Ollama.
 * `chunkTextFn`/`chatStreamFn` are injectable seams for tests.
 */
export async function* summarizeText(
  { text, title, url, mode, model, host, signal },
  { chunkTextFn = chunkText, chatStreamFn = chatStream } = {},
) {
  const cleanedContent = cleanText(text);
  let chunks = chunkTextFn(cleanedContent);
  if (chunks.length > MAX_CHUNKS) {
    let biggerSize = Math.ceil(cleanedContent.length / MAX_CHUNKS);
    chunks = chunkTextFn(cleanedContent, biggerSize);
    while (chunks.length > MAX_CHUNKS) {
      biggerSize *= 2;
      chunks = chunkTextFn(cleanedContent, biggerSize);
    }
  }

  // Errors are left to propagate: the caller (service-worker.js's buffered
  // stream runner) catches them and emits a clean `type:"error"` message,
  // same as offscreen.js's runStream does for WebLLM failures.

  // --- Single chunk: stream tokens directly ---
  if (chunks.length <= 1) {
    const prompt = buildSummaryPrompt(title, url, chunks[0] || "", mode);
    yield* chatStreamFn(host, model, prompt, { signal });
    return;
  }

  // Bullets: emit each chunk's bullets as it finishes so output starts
  // flowing immediately instead of after every chunk.
  if (mode === "bullets") {
    for (const chunk of chunks) {
      const prompt = buildSummaryPrompt(title, url, chunk, mode);
      let lineBuffer = "";
      for await (const token of chatStreamFn(host, model, prompt, { signal })) {
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
    const prompt = buildSummaryPrompt(title, url, chunk, mode);
    let partial = "";
    for await (const token of chatStreamFn(host, model, prompt, { signal })) {
      partial += token;
    }
    chunkSummaries.push(partial.trim());
  }

  const combinedText = chunkSummaries.join("\n");
  const mergePrompt = buildSummaryPrompt(title, url, combinedText, mode);
  yield* chatStreamFn(host, model, mergePrompt, { signal });
}
