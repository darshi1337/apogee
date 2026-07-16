// Matches sentence-ending punctuation followed by whitespace
const SENTENCE_END = /(?<=[.!?])\s+/;

/** Split text into chunks, breaking at sentence boundaries when possible. */
export function chunkText(text, chunkSize = 5000) {
  text = text.trim();

  if (!text) {
    return [];
  }

  // Use chunkSize to derive the single-chunk threshold so the parameter
  // isn't silently ignored for moderate-length texts.
  if (text.length <= chunkSize * 3) {
    return [text];
  }

  const sentences = text.split(SENTENCE_END);

  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const sentenceLen = sentence.length;

    // If a single sentence exceeds chunkSize, split it on word boundaries.
    if (sentenceLen > chunkSize) {
      if (currentChunk.length) {
        chunks.push(currentChunk.join(" "));
        currentChunk = [];
        currentLength = 0;
      }

      const words = sentence.trim().split(/\s+/).filter(Boolean);
      let part = [];
      let partLen = 0;
      for (const word of words) {
        if (partLen + word.length + 1 > chunkSize && part.length) {
          chunks.push(part.join(" "));
          part = [];
          partLen = 0;
        }
        part.push(word);
        partLen += word.length + 1;
      }
      if (part.length) {
        chunks.push(part.join(" "));
      }
      continue;
    }

    // Would this sentence push us over the limit?
    if (currentLength + sentenceLen + 1 > chunkSize && currentChunk.length) {
      chunks.push(currentChunk.join(" "));
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(sentence);
    currentLength += sentenceLen + 1;
  }

  if (currentChunk.length) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
}
