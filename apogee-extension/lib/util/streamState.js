import { appendStreamTextCapped } from "../extract/fileLimits.js";
import { broadcastToStream, safePost } from "./streamBroadcast.js";
import {
  finalTokensPerSecond,
  isWarmedUp,
  tokensForChunk,
  tokensPerSecond,
} from "./throughput.js";

// Shared buffered-stream state for worker and offscreen: same cap,
// counting, stats, and replay. Transport and extra flags stay per-side.

export function createStreamState(extra = {}) {
  return {
    text: "",
    done: false,
    error: null,
    cancelled: false,
    subscribers: new Set(),
    tokenCount: 0,
    startTime: performance.now(),
    firstTokenTime: null,
    tokensPerSec: null,
    elapsedMs: null,
    ...extra,
  };
}

// Capped accumulation (#269): keep the head so a runaway model cannot
// bloat memory. False when nothing new was accepted.
export function appendChunkToState(state, text) {
  if (!text || state.cancelled) return false;
  const capped = appendStreamTextCapped(state.text, text);
  const accepted = capped.text.length - state.text.length;
  state.text = capped.text;
  if (state.firstTokenTime == null) state.firstTokenTime = performance.now();
  state.tokenCount += tokensForChunk(
    accepted > 0 ? text.slice(0, accepted) : "",
  );
  return accepted > 0;
}

// Shared emit path for worker and offscreen (#349). False when nothing
// was accepted and nothing went out.
export function emitChunkToState(stream, text, scheduleCleanup) {
  if (!appendChunkToState(stream, text)) return false;
  broadcastToStream(stream, { type: "chunk", text });
  scheduleCleanup();
  const stats = warmedStatsForState(stream);
  if (stats) broadcastToStream(stream, stats);
  return true;
}

function elapsedFromStart(state, now, fallbackMs = 0) {
  return state.startTime != null
    ? Math.max(0, now - state.startTime)
    : fallbackMs;
}

// Live rate once warmed up; null before that to avoid noisy updates.
export function warmedStatsForState(state) {
  if (state.firstTokenTime == null) return null;
  const now = performance.now();
  const elapsedSinceFirst = now - state.firstTokenTime;
  if (!isWarmedUp(state.tokenCount, elapsedSinceFirst)) return null;
  return {
    type: "stats",
    tokensPerSec: tokensPerSecond(state.tokenCount, elapsedSinceFirst),
    elapsedMs: elapsedFromStart(state, now, elapsedSinceFirst),
  };
}

// Final stats prefer the backend count, which excludes network transit.
export function finishStateWithStats(state, msg) {
  state.done = true;
  const now = performance.now();
  const elapsedFromFirst =
    state.firstTokenTime != null ? now - state.firstTokenTime : 0;
  state.tokensPerSec =
    finalTokensPerSecond({
      serverStats: msg.serverStats ?? null,
      tokenCount: state.tokenCount,
      elapsedMs: elapsedFromFirst,
    }) || null;
  state.elapsedMs = elapsedFromStart(state, now, elapsedFromFirst);
  return {
    ...msg,
    tokensPerSec: state.tokensPerSec,
    elapsedMs: state.elapsedMs,
  };
}

// Late-subscriber catch-up: replay text, then the terminal or progress
// state. errorExtra carries the worker-only flag.
export function replayStreamToPort(stream, port, errorExtra) {
  if (stream.text) {
    safePost(port, { type: "chunk", text: stream.text });
  }
  if (stream.cancelled) {
    safePost(port, { type: "cancelled" });
  } else if (stream.error) {
    safePost(port, { type: "error", error: stream.error, ...errorExtra });
  } else if (stream.done) {
    safePost(port, {
      type: "done",
      tokensPerSec: stream.tokensPerSec,
      elapsedMs: stream.elapsedMs,
    });
  } else if (stream.firstTokenTime != null) {
    const stats = warmedStatsForState(stream);
    if (stats) {
      safePost(port, stats);
    }
  }
}
