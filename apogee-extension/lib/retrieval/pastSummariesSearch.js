import { dot, embedTexts as defaultEmbedTexts } from "../engines/embeddings.js";

/**
 * Searches stored past summaries using semantic vector search and keyword matching.
 *
 * @param {Object} options
 * @param {string} options.query - Search query string.
 * @param {Array} options.cacheOrder - Array of stored summary metadata [{ s, p, t, v }].
 * @param {Object} options.storedSummaries - Object mapping cacheKey -> summary text.
 * @param {Function} [options.embedTextsFn] - Function to embed search query.
 * @returns {Promise<Array>} Ordered array of matching cacheOrder item objects.
 */
export async function searchPastSummaries({
  query,
  cacheOrder = [],
  storedSummaries = {},
  embedTextsFn = defaultEmbedTexts,
}) {
  if (!cacheOrder || cacheOrder.length === 0) return [];
  const q = (query || "").trim();
  if (!q) {
    return [...cacheOrder];
  }

  const qLower = q.toLowerCase();

  let queryVector = null;
  if (embedTextsFn && typeof embedTextsFn === "function") {
    try {
      const embs = await embedTextsFn([q]);
      if (Array.isArray(embs) && embs[0]) {
        queryVector = embs[0];
      }
    } catch (err) {
      console.warn(
        "Failed to compute embedding for past summary search query:",
        err,
      );
    }
  }

  const results = [];

  for (const item of cacheOrder) {
    const title = (item.t || "").toLowerCase();
    const body = (storedSummaries[item.s] || "").toLowerCase();

    let textScore = 0;
    if (title.includes(qLower)) {
      textScore += 2.0;
    }
    if (body.includes(qLower)) {
      textScore += 1.0;
    }

    let vectorScore = 0;
    if (queryVector && item.v && Array.isArray(item.v)) {
      try {
        vectorScore = dot(queryVector, item.v);
      } catch {}
    }

    // Combine vector score and keyword match boost
    const score = vectorScore * 1.5 + textScore;

    // Inclusion criteria: If vector comparison occurred, match if score > 0.25 or keyword match exists If entry has no vector or query embedding failed, fallback to keyword match (textScore > 0)
    const isMatch =
      item.v && queryVector ? score > 0.25 || textScore > 0 : textScore > 0;

    if (isMatch) {
      results.push({ item, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.map((r) => r.item);
}
