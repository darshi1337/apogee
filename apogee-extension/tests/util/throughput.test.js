import test from "node:test";
import assert from "node:assert";
import {
  EST_CHARS_PER_TOKEN,
  tokensForChunk,
  isWarmedUp,
  tokensPerSecond,
  finalTokensPerSecond,
  formatTokensPerSecond,
  formatElapsedTime,
  formatRunMetrics,
} from "../../lib/util/throughput.js";

test("tokensForChunk counts a short chunk as one token", () => {
  assert.strictEqual(tokensForChunk("Hello"), 1);
});

test("tokensForChunk estimates a long, batched chunk from its length", () => {
  const text = "a".repeat(32);
  assert.strictEqual(tokensForChunk(text), text.length / EST_CHARS_PER_TOKEN);
});

test("tokensForChunk treats empty or nullish text as zero tokens", () => {
  assert.strictEqual(tokensForChunk(""), 0);
  assert.strictEqual(tokensForChunk(null), 0);
  assert.strictEqual(tokensForChunk(undefined), 0);
});

test("isWarmedUp is false until both the token and time thresholds clear", () => {
  assert.strictEqual(isWarmedUp(7, 1000), false);
  assert.strictEqual(isWarmedUp(8, 499), false);
  assert.strictEqual(isWarmedUp(8, 500), true);
  assert.strictEqual(isWarmedUp(20, 2000), true);
});

test("tokensPerSecond divides tokens by elapsed seconds", () => {
  assert.strictEqual(tokensPerSecond(28, 1000), 28);
});

test("tokensPerSecond returns zero for a non-positive elapsed time", () => {
  assert.strictEqual(tokensPerSecond(10, 0), 0);
  assert.strictEqual(tokensPerSecond(10, -5), 0);
});

test("finalTokensPerSecond prefers server-reported stats when valid", () => {
  const rate = finalTokensPerSecond({
    serverStats: { tokens: 100, durationMs: 2000 },
    tokenCount: 40,
    elapsedMs: 1000,
  });
  assert.strictEqual(rate, 50);
});

test("finalTokensPerSecond falls back to the computed rate without server stats", () => {
  const rate = finalTokensPerSecond({
    serverStats: null,
    tokenCount: 40,
    elapsedMs: 2000,
  });
  assert.strictEqual(rate, 20);
});

test("finalTokensPerSecond falls back when server stats are incomplete", () => {
  const rate = finalTokensPerSecond({
    serverStats: { tokens: 0, durationMs: 2000 },
    tokenCount: 40,
    elapsedMs: 2000,
  });
  assert.strictEqual(rate, 20);
});

test("formatTokensPerSecond keeps a decimal only where it carries meaning", () => {
  assert.strictEqual(formatTokensPerSecond(3.456), "3.5 tok/s");
  assert.strictEqual(formatTokensPerSecond(9.99), "10.0 tok/s");
  assert.strictEqual(formatTokensPerSecond(10), "10 tok/s");
  assert.strictEqual(formatTokensPerSecond(27.6), "28 tok/s");
});

test("formatTokensPerSecond renders nothing rather than a placeholder", () => {
  assert.strictEqual(formatTokensPerSecond(0), null);
  assert.strictEqual(formatTokensPerSecond(-1), null);
  assert.strictEqual(formatTokensPerSecond(NaN), null);
});

test("formatElapsedTime formats elapsed milliseconds to concise strings", () => {
  assert.strictEqual(formatElapsedTime(500), "0.5s");
  assert.strictEqual(formatElapsedTime(3200), "3.2s");
  assert.strictEqual(formatElapsedTime(10000), "10.0s");
  assert.strictEqual(formatElapsedTime(59949), "59.9s");
  assert.strictEqual(formatElapsedTime(59950), "1m 0s");
  assert.strictEqual(formatElapsedTime(59999), "1m 0s");
  assert.strictEqual(formatElapsedTime(60000), "1m 0s");
  assert.strictEqual(formatElapsedTime(65000), "1m 5s");
  assert.strictEqual(formatElapsedTime(119499), "1m 59s");
  assert.strictEqual(formatElapsedTime(119500), "2m 0s");
  assert.strictEqual(formatElapsedTime(119949), "2m 0s");
  assert.strictEqual(formatElapsedTime(119950), "2m 0s");
  assert.strictEqual(formatElapsedTime(120000), "2m 0s");
  assert.strictEqual(formatElapsedTime(179500), "3m 0s");
});

test("formatElapsedTime returns null for invalid or non-positive durations", () => {
  assert.strictEqual(formatElapsedTime(0), null);
  assert.strictEqual(formatElapsedTime(-100), null);
  assert.strictEqual(formatElapsedTime(NaN), null);
  assert.strictEqual(formatElapsedTime(null), null);
  assert.strictEqual(formatElapsedTime(undefined), null);
});

test("formatRunMetrics combines rate and elapsed time", () => {
  assert.strictEqual(formatRunMetrics(14.2, 3200), "14 tok/s · 3.2s");
  assert.strictEqual(formatRunMetrics(3.456, 1200), "3.5 tok/s · 1.2s");
  assert.strictEqual(formatRunMetrics(14, null), "14 tok/s");
  assert.strictEqual(formatRunMetrics(null, 3200), "3.2s");
  assert.strictEqual(formatRunMetrics(null, null), null);
  assert.strictEqual(formatRunMetrics(0, 0), null);
  assert.strictEqual(formatRunMetrics(NaN, NaN), null);
});
