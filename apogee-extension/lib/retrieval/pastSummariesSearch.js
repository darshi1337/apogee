import { dot, embedTexts as defaultEmbedTexts } from "../engines/embeddings.js";

// Searches stored past summaries using semantic vector search and keyword matching.
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
      } catch {
        // intent: skip malformed/incompatible vector, leave score unset
      }
    }

    const score = vectorScore * 1.5 + textScore;

    // Vector matches need a minimum score; keyword-only entries fall back to text matches.
    const isMatch =
      item.v && queryVector ? score > 0.25 || textScore > 0 : textScore > 0;

    if (isMatch) {
      results.push({ item, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.map((r) => r.item);
}
