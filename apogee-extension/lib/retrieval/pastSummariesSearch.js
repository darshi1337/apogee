import { dot, embedTexts as defaultEmbedTexts } from "../engines/embeddings.js";
import { MAX_CACHED_PAGES } from "../storage/pageCache.js";

const EMBEDDING_BATCH_SIZE = 4;
const embeddingCache = new Map();
let cacheGeneration = 0;

export function clearPastSummariesSearchCache() {
  cacheGeneration++;
  embeddingCache.clear();
}

function isVector(vector, dimensions = vector?.length) {
  if (
    !Array.isArray(vector) ||
    !(dimensions > 0) ||
    vector.length !== dimensions
  )
    return false;
  for (const value of vector) {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
  }
  return true;
}

function pruneEmbeddingCache(cacheOrder, storedSummaries) {
  const keys = new Set(cacheOrder.map((item) => item?.s));
  for (const [key, cached] of embeddingCache) {
    if (!keys.has(key) || storedSummaries[key] !== cached.text) {
      embeddingCache.delete(key);
    }
  }
}

async function summaryVectors(
  cacheOrder,
  storedSummaries,
  embedTextsFn,
  dimensions,
  signal,
  generation,
) {
  const vectors = new Map();
  for (
    let start = 0;
    start < cacheOrder.length;
    start += EMBEDDING_BATCH_SIZE
  ) {
    if (signal?.aborted || generation !== cacheGeneration) break;
    const pending = [];
    const missing = [];
    for (const item of cacheOrder.slice(start, start + EMBEDDING_BATCH_SIZE)) {
      if (!item?.s) continue;
      if (isVector(item.v, dimensions)) {
        vectors.set(item.s, item.v);
        continue;
      }
      const text = storedSummaries[item.s];
      if (typeof text !== "string" || !text.trim()) continue;
      let cached = embeddingCache.get(item.s);
      if (
        !cached ||
        cached.text !== text ||
        cached.embedTextsFn !== embedTextsFn ||
        cached.dimensions !== dimensions
      ) {
        let resolve;
        const promise = new Promise((done) => {
          resolve = done;
        });
        cached = { text, embedTextsFn, dimensions, promise, resolve };
        embeddingCache.set(item.s, cached);
        missing.push({ key: item.s, cached });
        while (embeddingCache.size > MAX_CACHED_PAGES) {
          embeddingCache.delete(embeddingCache.keys().next().value);
        }
      }
      pending.push({ key: item.s, cached });
    }

    if (missing.length > 0) {
      let embeddings;
      try {
        embeddings = await embedTextsFn(
          missing.map(({ cached }) => cached.text),
        );
      } catch (err) {
        console.warn("Failed to embed past summaries:", err);
      }
      for (let i = 0; i < missing.length; i++) {
        const { key, cached } = missing[i];
        const vector = Array.isArray(embeddings) ? embeddings[i] : null;
        const valid = isVector(vector, dimensions);
        if (!valid && embeddingCache.get(key) === cached) {
          embeddingCache.delete(key);
        }
        // A reset or replacement can discard this record while inference runs.
        // Resolving it never inserts it into the cache again.
        cached.resolve(valid ? vector : null);
      }
    }
    for (const { key, cached } of pending) {
      const vector = await cached.promise;
      if (vector) vectors.set(key, vector);
    }
  }
  return vectors;
}

export async function searchPastSummaries({
  query,
  cacheOrder = [],
  storedSummaries = {},
  embedTextsFn = defaultEmbedTexts,
  signal,
}) {
  if (!Array.isArray(cacheOrder) || cacheOrder.length === 0) {
    clearPastSummariesSearchCache();
    return [];
  }
  pruneEmbeddingCache(cacheOrder, storedSummaries);
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) return [...cacheOrder];
  if (signal?.aborted) return [];
  const generation = cacheGeneration;

  const qLower = q.toLowerCase();
  let queryVector = null;
  let vectors = new Map();
  if (typeof embedTextsFn === "function") {
    try {
      const embeddings = await embedTextsFn([q]);
      if (signal?.aborted || generation !== cacheGeneration) return [];
      if (Array.isArray(embeddings) && isVector(embeddings[0])) {
        queryVector = embeddings[0];
        vectors = await summaryVectors(
          cacheOrder,
          storedSummaries,
          embedTextsFn,
          queryVector.length,
          signal,
          generation,
        );
      }
    } catch (err) {
      console.warn(
        "Failed to compute embedding for past summary search query:",
        err,
      );
    }
  }
  if (signal?.aborted || generation !== cacheGeneration) return [];

  const results = [];
  for (const item of cacheOrder) {
    if (!item?.s) continue;
    const title = typeof item.t === "string" ? item.t.toLowerCase() : "";
    const text = storedSummaries[item.s];
    const body = typeof text === "string" ? text.toLowerCase() : "";
    const textScore =
      (title.includes(qLower) ? 2.0 : 0) + (body.includes(qLower) ? 1.0 : 0);
    const vector = vectors.get(item.s);
    const similarity = queryVector && vector ? dot(queryVector, vector) : 0;
    const vectorScore = Number.isFinite(similarity) ? similarity : 0;
    const score = vectorScore * 1.5 + textScore;

    if (textScore > 0 || (vector && score > 0.25)) {
      results.push({ item, score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.map(({ item }) => item);
}
