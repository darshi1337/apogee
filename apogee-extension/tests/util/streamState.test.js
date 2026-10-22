import test from "node:test";
import assert from "node:assert";
import {
  createStreamState,
  appendChunkToState,
  emitChunkToState,
  warmedStatsForState,
  finishStateWithStats,
  replayStreamToPort,
} from "../../lib/util/streamState.js";
import { MAX_STREAM_TEXT_CHARS } from "../../lib/extract/fileLimits.js";
import { createCollectingPort } from "../helpers/streamTestUtils.js";

function withMockPerformanceClock(fn) {
  const origNow = performance.now;
  let currentTime = 1000;
  performance.now = () => currentTime;
  const advanceClock = (ms) => {
    currentTime += ms;
  };
  const restoreClock = () => {
    performance.now = origNow;
  };

  let result;
  try {
    result = fn({ advanceClock });
  } catch (err) {
    restoreClock();
    throw err;
  }
  // Keep the mock clock installed until async test bodies settle; otherwise
  // the real clock leaks into post-await assertions.
  if (result && typeof result.then === "function") {
    return result.finally(restoreClock);
  }
  restoreClock();
  return result;
}

test("createStreamState initializes default fields and merges extra options", () => {
  const state = createStreamState({ extraFlag: true, customId: 123 });
  assert.strictEqual(state.text, "");
  assert.strictEqual(state.done, false);
  assert.strictEqual(state.error, null);
  assert.strictEqual(state.cancelled, false);
  assert.ok(state.subscribers instanceof Set);
  assert.strictEqual(state.subscribers.size, 0);
  assert.strictEqual(state.tokenCount, 0);
  assert.strictEqual(state.firstTokenTime, null);
  assert.strictEqual(state.tokensPerSec, null);
  assert.strictEqual(state.elapsedMs, null);
  assert.ok(typeof state.startTime === "number");
  assert.strictEqual(state.extraFlag, true);
  assert.strictEqual(state.customId, 123);
});

test("appendChunkToState ignores empty or cancelled chunks", () => {
  const state = createStreamState();
  assert.strictEqual(appendChunkToState(state, ""), false);
  assert.strictEqual(appendChunkToState(state, null), false);
  assert.strictEqual(appendChunkToState(state, undefined), false);
  assert.strictEqual(state.text, "");
  assert.strictEqual(state.firstTokenTime, null);

  const cancelledState = createStreamState({ cancelled: true });
  assert.strictEqual(appendChunkToState(cancelledState, "hello"), false);
  assert.strictEqual(cancelledState.text, "");
});

test("appendChunkToState sets firstTokenTime and increments text and tokenCount", () => {
  withMockPerformanceClock(({ advanceClock }) => {
    const state = createStreamState();
    const result = appendChunkToState(state, "Hello world");
    assert.strictEqual(result, true);
    assert.strictEqual(state.text, "Hello world");
    assert.strictEqual(state.firstTokenTime, 1000);
    assert.ok(state.tokenCount > 0);

    advanceClock(100);
    appendChunkToState(state, " another chunk");
    assert.strictEqual(state.firstTokenTime, 1000); // timestamp unchanged
    assert.strictEqual(state.text, "Hello world another chunk");
  });
});

test("appendChunkToState caps text at MAX_STREAM_TEXT_CHARS and counts tokens for accepted prefix only", () => {
  const state = createStreamState();
  const nearMaxHead = "a".repeat(MAX_STREAM_TEXT_CHARS - 5);
  appendChunkToState(state, nearMaxHead);
  const initialTokens = state.tokenCount;

  // Append 10 chars ("1234567890"), only 5 ("12345") should be accepted
  const res1 = appendChunkToState(state, "1234567890");
  assert.strictEqual(res1, true);
  assert.strictEqual(state.text.length, MAX_STREAM_TEXT_CHARS);
  assert.ok(state.text.endsWith("12345"));
  const tokensAfterCap = state.tokenCount;
  assert.strictEqual(tokensAfterCap, initialTokens + 1); // exact 1 token for "12345" (accepted 5 chars)

  // Appending past max length reports no new text, so callers broadcast nothing
  const res2 = appendChunkToState(state, "extra");
  assert.strictEqual(res2, false);
  assert.strictEqual(state.text.length, MAX_STREAM_TEXT_CHARS);
  assert.strictEqual(state.tokenCount, tokensAfterCap);
});

test("emitChunkToState broadcasts chunk + heartbeat, and nothing at cap", () => {
  const state = createStreamState();
  const port = createCollectingPort();
  state.subscribers.add(port);
  let heartbeats = 0;
  const heartbeat = () => heartbeats++;

  assert.strictEqual(emitChunkToState(state, "hello", heartbeat), true);
  assert.deepStrictEqual(port.messages, [{ type: "chunk", text: "hello" }]);
  assert.strictEqual(heartbeats, 1);

  state.text = "a".repeat(MAX_STREAM_TEXT_CHARS);
  assert.strictEqual(emitChunkToState(state, "more", heartbeat), false);
  assert.strictEqual(port.messages.length, 1);
  assert.strictEqual(heartbeats, 1);
});

test("warmedStatsForState returns null until time and token thresholds clear", () => {
  withMockPerformanceClock(({ advanceClock }) => {
    const state = createStreamState();

    // No firstTokenTime
    assert.strictEqual(warmedStatsForState(state), null);

    // Initial chunk
    appendChunkToState(state, "short");
    assert.strictEqual(warmedStatsForState(state), null);

    // Add enough tokens (>= 8) but insufficient time (< 500 ms)
    for (let i = 0; i < 10; i++) {
      appendChunkToState(state, " chunk");
    }
    assert.strictEqual(warmedStatsForState(state), null);

    // Advance time past 500 ms threshold
    advanceClock(500);
    const stats = warmedStatsForState(state);
    assert.ok(stats);
    assert.strictEqual(stats.type, "stats");
    assert.ok(stats.tokensPerSec > 0);
    assert.strictEqual(stats.elapsedMs, 500);
  });
});

test("finishStateWithStats computes throughput and sets state.done", () => {
  withMockPerformanceClock(({ advanceClock }) => {
    const state = createStreamState();
    appendChunkToState(state, "Test chunk content for finish state math");
    advanceClock(1000);

    const msg = { type: "done" };
    const finishedMsg = finishStateWithStats(state, msg);

    assert.strictEqual(state.done, true);
    assert.ok(state.tokensPerSec > 0);
    assert.strictEqual(state.elapsedMs, 1000);
    assert.strictEqual(finishedMsg.type, "done");
    assert.strictEqual(finishedMsg.tokensPerSec, state.tokensPerSec);
    assert.strictEqual(finishedMsg.elapsedMs, 1000);
  });
});

test("finishStateWithStats prefers valid serverStats over fallback elapsed math", () => {
  withMockPerformanceClock(({ advanceClock }) => {
    const state = createStreamState();
    appendChunkToState(state, "Short");
    advanceClock(1000);

    const msg = {
      type: "done",
      serverStats: { tokens: 100, durationMs: 2000 },
    };
    const finishedMsg = finishStateWithStats(state, msg);

    assert.strictEqual(state.done, true);
    assert.strictEqual(state.tokensPerSec, 50); // 100 tokens / 2s
    assert.strictEqual(state.elapsedMs, 1000);
    assert.strictEqual(finishedMsg.tokensPerSec, 50);
    assert.strictEqual(finishedMsg.elapsedMs, 1000);
  });
});

test("replayStreamToPort replays chunk and terminal/progress states in order without modifying subscribers", () => {
  withMockPerformanceClock(({ advanceClock }) => {
    // 1. In-progress stream (warmed up)
    const activeState = createStreamState();
    appendChunkToState(activeState, "Hello ");
    for (let i = 0; i < 10; i++) appendChunkToState(activeState, "world ");
    advanceClock(600);

    const port1 = createCollectingPort();
    const origSubscribers = new Set(activeState.subscribers);
    replayStreamToPort(activeState, port1, { userFacing: true });

    assert.strictEqual(port1.messages.length, 2);
    assert.deepStrictEqual(port1.messages[0], {
      type: "chunk",
      text: activeState.text,
    });
    assert.strictEqual(port1.messages[1].type, "stats");
    assert.ok(port1.messages[1].tokensPerSec > 0);
    assert.strictEqual(port1.messages[1].elapsedMs, 600);
    assert.deepStrictEqual(activeState.subscribers, origSubscribers);

    // 2. Cancelled stream
    const cancelledState = createStreamState({
      text: "Partial",
      cancelled: true,
    });
    const port2 = createCollectingPort();
    replayStreamToPort(cancelledState, port2);
    assert.deepStrictEqual(port2.messages, [
      { type: "chunk", text: "Partial" },
      { type: "cancelled" },
    ]);

    // 3. Error stream with errorExtra
    const errorState = createStreamState({
      text: "Partial",
      error: "Failed to connect",
    });
    const port3 = createCollectingPort();
    replayStreamToPort(errorState, port3, { userFacing: true });
    assert.deepStrictEqual(port3.messages, [
      { type: "chunk", text: "Partial" },
      { type: "error", error: "Failed to connect", userFacing: true },
    ]);

    // 4. Done stream
    const doneState = createStreamState({
      text: "Complete answer",
      done: true,
      tokensPerSec: 25,
      elapsedMs: 2500,
    });
    const port4 = createCollectingPort();
    replayStreamToPort(doneState, port4);
    assert.deepStrictEqual(port4.messages, [
      { type: "chunk", text: "Complete answer" },
      { type: "done", tokensPerSec: 25, elapsedMs: 2500 },
    ]);
  });
});

test("replayStreamToPort safely catches errors if port.postMessage throws", () => {
  const doneState = createStreamState({
    text: "Text",
    done: true,
    tokensPerSec: 10,
  });
  const throwingPort = createCollectingPort({ throwOnPost: true });

  assert.doesNotThrow(() => {
    replayStreamToPort(doneState, throwingPort);
  });
});
