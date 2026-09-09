import { chunkText } from "../summarize/chunk.js";
import { embedTexts as embedTextsDefault, dot } from "../engines/embeddings.js";
import { cyrb53 } from "../util/hash.js";

const RETRIEVAL_CHUNK_CHARS = 1000;
const DEFAULT_MAX_CONTEXT_CHARS = 6000;
const DEFAULT_TOP_K = 8;

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
const MIN_REFINE_SENTENCE_CHARS = 25;

const MAX_CACHE_ENTRIES = 5;
const indexCache = new Map();

// Length-prefixed so two different documents can only collide on both the
// 53-bit hash and the exact byte length, closing the truncation-collision
// class without paying for an async SHA-256 on every lookup.
export function ragIndexCacheKey(content) {
  return `${content.length}:${cyrb53(content)}`;
}

async function getOrBuildIndex(content, embedTextsFn) {
  const key = ragIndexCacheKey(content);
  const cached = indexCache.get(key);
  if (cached) return cached;

  const chunks = chunkText(content, RETRIEVAL_CHUNK_CHARS);
  const embeddings = await embedTextsFn(chunks);

  const index = { chunks, embeddings };
  indexCache.set(key, index);
  while (indexCache.size > MAX_CACHE_ENTRIES) {
    indexCache.delete(indexCache.keys().next().value);
  }
  return index;
}

export async function selectSalientChunks(
  chunks,
  maxChunks,
  { embedTextsFn = embedTextsDefault } = {},
) {
  if (!Array.isArray(chunks) || chunks.length <= maxChunks) return chunks;

  try {
    const embeddings = await embedTextsFn(chunks);
    const dim = embeddings[0].length;

    const centroid = new Array(dim).fill(0);
    for (const e of embeddings) {
      for (let d = 0; d < dim; d++) centroid[d] += e[d];
    }
    for (let d = 0; d < dim; d++) centroid[d] /= embeddings.length;
    const salience = embeddings.map((e) => dot(e, centroid));

    const LAMBDA = 0.7;
    const chosen = [];
    const remaining = new Set(embeddings.map((_, i) => i));
    while (chosen.length < maxChunks && remaining.size) {
      let bestIndex = -1;
      let bestScore = -Infinity;
      for (const i of remaining) {
        const diversity = chosen.length
          ? Math.max(...chosen.map((j) => dot(embeddings[i], embeddings[j])))
          : 0;
        const score = LAMBDA * salience[i] - (1 - LAMBDA) * diversity;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      chosen.push(bestIndex);
      remaining.delete(bestIndex);
    }

    chosen.sort((a, b) => a - b);
    return chosen.map((i) => chunks[i]);
  } catch (err) {
    console.error("selectSalientChunks failed:", err);
    return null;
  }
}

export async function retrieveRelevantContent(
  {
    content,
    question,
    maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
    topK = DEFAULT_TOP_K,
  },
  { embedTextsFn = embedTextsDefault } = {},
) {
  const clean = (content || "").trim();
  if (clean.length <= maxContextChars) return clean;

  try {
    const index = await getOrBuildIndex(clean, embedTextsFn);
    if (index.chunks.length <= 1) return clean.slice(0, maxContextChars);

    const [questionEmbedding] = await embedTextsFn([question]);
    const scored = index.chunks.map((chunk, i) => ({
      chunk,
      index: i,
      score: dot(questionEmbedding, index.embeddings[i]),
    }));
    scored.sort((a, b) => b.score - a.score);

    const picked = [];
    let total = 0;
    for (const item of scored) {
      if (picked.length >= topK) break;
      if (total + item.chunk.length > maxContextChars && picked.length > 0) {
        continue;
      }
      picked.push(item);
      total += item.chunk.length;
    }
    picked.sort((a, b) => a.index - b.index);
    return picked.map((p) => p.chunk).join("\n\n");
  } catch (err) {
    console.error("RAG retrieval failed, falling back to truncation:", err);
    return clean.slice(0, maxContextChars) + "\n\n[...content truncated...]";
  }
}

async function refineToBestSentence(chunk, queryEmbedding, embedTextsFn) {
  const sentences = chunk
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_REFINE_SENTENCE_CHARS);
  if (sentences.length <= 1) return null;

  const embeddings = await embedTextsFn(sentences);
  let best = null;
  for (let i = 0; i < sentences.length; i++) {
    const score = dot(queryEmbedding, embeddings[i]);
    if (!best || score > best.score) best = { text: sentences[i], score };
  }
  return best?.text ?? null;
}

export async function findBestPassage(
  { content, query },
  { embedTextsFn = embedTextsDefault } = {},
) {
  const clean = (content || "").trim();
  if (!clean || !query) return null;

  try {
    const index = await getOrBuildIndex(clean, embedTextsFn);
    if (index.chunks.length === 0) return null;

    const [queryEmbedding] = await embedTextsFn([query]);
    let best = null;
    for (let i = 0; i < index.chunks.length; i++) {
      const score = dot(queryEmbedding, index.embeddings[i]);
      if (!best || score > best.score) {
        best = { chunk: index.chunks[i], score };
      }
    }

    let passage = best.chunk;
    try {
      const sentence = await refineToBestSentence(
        best.chunk,
        queryEmbedding,
        embedTextsFn,
      );
      if (sentence) passage = sentence;
    } catch (err) {
      console.error("findBestPassage sentence refinement failed:", err);
    }
    return { chunk: passage, score: best.score };
  } catch (err) {
    console.error("findBestPassage failed:", err);
    return null;
  }
}
