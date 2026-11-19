import { cleanModelOutput } from "../lib/util/markdown.js";

const MIN_PREVIEW_DELAY_MS = 32;
const MAX_PREVIEW_DELAY_MS = 250;
const MS_PER_KIB_CHARS = 8;

export async function renderSummaryStream(stream, render) {
  let fullText = "";
  let hasText = false;
  let previewTimer = null;

  try {
    for await (const chunk of stream) {
      fullText += chunk;
      hasText ||= /\S/.test(chunk);
      if (!hasText || previewTimer !== null) continue;

      // Full Markdown renders cost more as the buffer grows. Cap the delay
      // so the preview still updates during long summaries.
      const delay = Math.min(
        MAX_PREVIEW_DELAY_MS,
        MIN_PREVIEW_DELAY_MS + (fullText.length / 1024) * MS_PER_KIB_CHARS,
      );
      previewTimer = setTimeout(() => {
        previewTimer = null;
        render(cleanModelOutput(fullText));
      }, delay);
    }
  } finally {
    if (previewTimer !== null) clearTimeout(previewTimer);
  }

  const finalText = cleanModelOutput(fullText);
  render(finalText);
  return finalText;
}
