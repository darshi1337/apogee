// Retrieval-augmented context selection for "Ask" (see buildAnswerPrompt
// callers in background/service-worker.js). Replaces the old blind
// head-of-document truncation with picking the chunks most relevant to the
// question, so a long article/PDF/transcript no longer silently loses
// everything past the first ~8000 characters.

import { chunkText } from "./chunk.js";
import { embedTexts as embedTextsDefault, dot } from "./embeddings.js";

// Smaller than MAX_CHUNK_CHARS (used for summarization's map-reduce): finer
// granularity here means retrieval can zero in on the specific passage that
// answers the question instead of pulling in a whole 6000-char neighborhood.
const RETRIEVAL_CHUNK_CHARS = 1000;
const DEFAULT_MAX_CONTEXT_CHARS = 6000;
const DEFAULT_TOP_K = 8;

// Caches built chunk embeddings per page so asking several follow-up
// questions about the same page only embeds the document once. Keyed by a
// hash of the content text itself (not the URL), since the same URL can
// legitimately carry different content across calls. A plain in-memory Map
// is fine: this module only ever runs inside the offscreen document (see
// callers in offscreen.js), which stays alive for OFFSCREEN_IDLE_MINUTES of
// inactivity rather than getting evicted like the service worker, so this is
// a perf cache bounded by MAX_CACHE_ENTRIES, not a correctness dependency.
const MAX_CACHE_ENTRIES = 5;
const indexCache = new Map();

function hashContent(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

async function getOrBuildIndex(content, embedTextsFn) {
  const key = hashContent(content);
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

/**
 * Returns a trimmed slice of `content`, made up of whichever chunks are most
 * relevant to `question` by embedding similarity, up to `maxContextChars`.
 * Content already within budget is returned unchanged (no embedding cost for
 * short pages/emails). Falls back to a plain prefix truncation if embedding
 * fails for any reason (e.g. the model couldn't be fetched on first use).
 */
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
    // Restore original document order so the merged passages still read
    // coherently, rather than in similarity-rank order.
    picked.sort((a, b) => a.index - b.index);
    return picked.map((p) => p.chunk).join("\n\n");
  } catch (err) {
    console.error("RAG retrieval failed, falling back to truncation:", err);
    return clean.slice(0, maxContextChars) + "\n\n[...content truncated...]";
  }
}

/**
 * Finds the single original-content chunk most similar to `query` (e.g. a
 * clicked summary bullet), for "click a bullet, highlight the matching
 * passage in the page" (see content/highlight.js and the "find-passage"
 * action in offscreen.js). Unlike retrieveRelevantContent, which merges
 * several chunks into one prompt-sized blob for an LLM, this returns exactly
 * one chunk plus its similarity score: the caller needs a single contiguous
 * span of *verbatim page text* to search for and highlight in the live DOM,
 * and needs the score to decide whether the match is confident enough to
 * act on at all (a top-1 match always returns something, even for a bullet
 * that's a cross-page synthesis with no single matching passage).
 *
 * Shares the same content-hash-keyed index (and RETRIEVAL_CHUNK_CHARS
 * granularity) as retrieveRelevantContent, so asking a question and then
 * clicking bullets on the same page only embeds the document once.
 *
 * Returns null if `content`/`query` is empty or embedding fails for any
 * reason; there's no truncation fallback the way retrieveRelevantContent
 * has, a null result here just means "don't highlight anything."
 */
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
    return best;
  } catch (err) {
    console.error("findBestPassage failed:", err);
    return null;
  }
}
