// 4.7 chars is a heuristic average, not a tokenizer. It only affects long
// batched chunks; recalibrate if the display drifts from backend rates.
export const EST_CHARS_PER_TOKEN = 4.7;
const LONG_CHUNK_CHARS = 16;

const WARMUP_MIN_TOKENS = 8;
const WARMUP_MIN_MS = 500;

const DECIMAL_CUTOFF_TOKENS_PER_SEC = 10;

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

export function formatElapsedTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(1)}s`;
  }
  const mins = Math.floor(s / 60);
  const remSec = Math.round(s % 60);
  return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
}

export function formatRunMetrics(rate, elapsedMs) {
  const formattedRate = formatTokensPerSecond(rate);
  const formattedElapsed = formatElapsedTime(elapsedMs);
  if (formattedRate && formattedElapsed) {
    return `${formattedRate} · ${formattedElapsed}`;
  }
  return formattedRate || formattedElapsed || null;
}
