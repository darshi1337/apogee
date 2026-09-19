import { appendStreamTextCapped } from "../extract/fileLimits.js";
import {
  finalTokensPerSecond,
  isWarmedUp,
  tokensForChunk,
  tokensPerSecond,
} from "./throughput.js";

// Shared buffered-stream state for the service worker and the offscreen
// document: same accumulation cap, same accepted-prefix token counting, same
// final-stats math, same late-subscriber replay. Transport stays per-side
// (alarms cleanup + finalizeSummaryJob in the worker, setTimeout cleanup +
// stream-finished relay in offscreen), as do the extra flags each side keeps
// (AbortController, errorUserFacing) via the `extra` slot.

export function createStreamState(extra = {}) {
  return {
    text: "",
    done: false,
    error: null,
    cancelled: false,
    subscribers: new Set(),
    tokenCount: 0,
    firstTokenTime: null,
    tokensPerSec: null,
    ...extra,
  };
}

// Capped accumulation for one chunk (#269): keeps the head and drops the
// tail so a runaway model cannot bloat worker memory. Counts only the
// accepted prefix toward tokens. Returns false for empty/cancelled chunks,
// in which case the caller broadcasts nothing.
export function appendChunkToState(state, text) {
  if (!text || state.cancelled) return false;
  const capped = appendStreamTextCapped(state.text, text);
  const accepted = capped.text.length - state.text.length;
  state.text = capped.text;
  if (state.firstTokenTime == null) state.firstTokenTime = performance.now();
  state.tokenCount += tokensForChunk(
    accepted > 0 ? text.slice(0, accepted) : "",
  );
  return true;
}

// Live rate update once enough tokens and time have passed; null before that
// so callers broadcast only real updates.
export function warmedStatsForState(state) {
  if (state.firstTokenTime == null) return null;
  const elapsedMs = performance.now() - state.firstTokenTime;
  if (!isWarmedUp(state.tokenCount, elapsedMs)) return null;
  return {
    type: "stats",
    tokensPerSec: tokensPerSecond(state.tokenCount, elapsedMs),
  };
}

// Final-stats math shared by both finish paths: prefers the backend's own
// token count and duration (which exclude network transit) and stamps the
// outgoing message with the computed rate.
export function finishStateWithStats(state, msg) {
  state.done = true;
  const elapsedMs =
    state.firstTokenTime != null ? performance.now() - state.firstTokenTime : 0;
  state.tokensPerSec =
    finalTokensPerSecond({
      serverStats: msg.serverStats ?? null,
      tokenCount: state.tokenCount,
      elapsedMs,
    }) || null;
  return { ...msg, tokensPerSec: state.tokensPerSec };
}

// Late-subscriber catch-up: replay the accumulated text, then whichever
// terminal or progress state the stream is in. errorExtra carries the
// worker-only userFacing flag; offscreen passes nothing.
export function replayStreamToPort(stream, port, errorExtra) {
  if (stream.text) {
    try {
      port.postMessage({ type: "chunk", text: stream.text });
    } catch {}
  }
  if (stream.cancelled) {
    try {
      port.postMessage({ type: "cancelled" });
    } catch {}
  } else if (stream.error) {
    try {
      port.postMessage({ type: "error", error: stream.error, ...errorExtra });
    } catch {}
  } else if (stream.done) {
    try {
      port.postMessage({ type: "done", tokensPerSec: stream.tokensPerSec });
    } catch {}
  } else if (stream.firstTokenTime != null) {
    const stats = warmedStatsForState(stream);
    if (stats) {
      try {
        port.postMessage(stats);
      } catch {}
    }
  }
}
