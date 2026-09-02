// ponytail: 4.7 is a heuristic average, not a real tokenizer. It only ever affects a chunk longer than LONG_CHUNK_CHARS (a batched/estimated delta, not a per-token one) — recalibrate if the display rate visibly drifts from a backend's own self-reported rate.
export const EST_CHARS_PER_TOKEN = 4.7;
export const LONG_CHUNK_CHARS = 16;

export const WARMUP_MIN_TOKENS = 8;
export const WARMUP_MIN_MS = 500;

export const DECIMAL_CUTOFF_TOKENS_PER_SEC = 10;

export function tokensForChunk(text) {
  if (!text) return 0;
  return text.length <= LONG_CHUNK_CHARS
    ? 1
    : text.length / EST_CHARS_PER_TOKEN;
}

export function isWarmedUp(tokenCount, elapsedMs) {
  return tokenCount >= WARMUP_MIN_TOKENS && elapsedMs >= WARMUP_MIN_MS;
}

export function tokensPerSecond(tokenCount, elapsedMs) {
  if (elapsedMs <= 0) return 0;
  return tokenCount / (elapsedMs / 1000);
}

export function finalTokensPerSecond({ serverStats, tokenCount, elapsedMs }) {
  if (serverStats && serverStats.tokens > 0 && serverStats.durationMs > 0) {
    return tokensPerSecond(serverStats.tokens, serverStats.durationMs);
  }
  return tokensPerSecond(tokenCount, elapsedMs);
}

export function formatTokensPerSecond(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate >= DECIMAL_CUTOFF_TOKENS_PER_SEC
    ? `${Math.round(rate)} tok/s`
    : `${rate.toFixed(1)} tok/s`;
}
