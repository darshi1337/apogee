import { chunkText } from "./chunk.js";
import {
  buildYoutubeMapPrompt,
  buildYoutubeAssemblyPrompt,
  buildYoutubeBriefPrompt,
  withCustomInstructions,
} from "./prompts.js";
import { parseChaptersBlock, stripChaptersBlock } from "./youtubeChapters.js";
import { timestampToSeconds } from "./timestamps.js";
import { detectPrimaryLanguage } from "../language/detectLanguage.js";
import { cleanText } from "./cleaner.js";
import { chatStream } from "../engines/ollamaClient.js";
import { mapReduceStream } from "./mapReduce.js";

const TIMESTAMP_MARKER = /\[(\d{1,2}(?::\d{2}){1,2})\]/g;

const YOUTUBE_MAP_CHUNK_CHARS = 8192;

function lastAvailableSecondsIn(text) {
  let last = 0;
  for (const match of text.matchAll(TIMESTAMP_MARKER)) {
    const seconds = timestampToSeconds(match[1]);
    if (seconds > last) last = seconds;
  }
  return last;
}

export async function* summarizeYoutube(
  { text, title, url, model, host, signal, language, customInstructions },
  {
    chunkTextFn = chunkText,
    chatStreamFn = chatStream,
    onProgress,
    detectLanguageFn = detectPrimaryLanguage,
    translateFn,
  } = {},
) {
  const cleanedContent = cleanText(text);

  const cappedChunkTextFn = (t, maxChars) =>
    chunkTextFn(t, Math.min(maxChars, YOUTUBE_MAP_CHUNK_CHARS));

  const chapters = parseChaptersBlock(cleanedContent);
  const transcriptContent = chapters.length
    ? stripChaptersBlock(cleanedContent)
    : cleanedContent;
  const lastAvailableSeconds = lastAvailableSecondsIn(transcriptContent);

  const buildAssembly = (noteText) =>
    withCustomInstructions(
      chapters.length
        ? buildYoutubeBriefPrompt(
            title,
            url,
            noteText,
            chapters,
            lastAvailableSeconds,
          )
        : buildYoutubeAssemblyPrompt(
            title,
            url,
            noteText,
            lastAvailableSeconds,
          ),
      customInstructions,
    );

  yield* mapReduceStream(
    { text: transcriptContent, model, host, signal, language },
    {
      chunkTextFn: cappedChunkTextFn,
      chatStreamFn,
      onProgress,
      detectLanguageFn,
      translateFn,
    },
    {
      buildSingle: (chunk) => buildAssembly(chunk),
      buildMap: (chunk, i, total) =>
        buildYoutubeMapPrompt(title, chunk, i, total),
      buildReduce: (notes) => buildAssembly(notes.join("\n")),
    },
  );
}
