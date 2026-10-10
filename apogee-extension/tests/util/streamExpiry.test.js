import test from "node:test";
import assert from "node:assert";

import { readSource } from "../helpers/readSource.js";
import {
  createSlidingExpiry,
  STREAM_CLEANUP_MS,
} from "../../lib/util/streamExpiry.js";

// Issue #314: a fixed 2-min cleanup expired long map-reduce summaries
// mid-generation even though tokens were still arriving. Expiry must slide
// on progress: an actively progressing stream never expires, while an idle
// stream is still reclaimed.

test("expiry window constant stays at 2 minutes", () => {
  assert.strictEqual(STREAM_CLEANUP_MS, 2 * 60 * 1000);
});

test("idle stream is reclaimed after the window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const expired = [];
    const expiry = createSlidingExpiry({
      timeoutMs: STREAM_CLEANUP_MS,
      onExpire: (id) => expired.push(id),
    });
    expiry.schedule("stream-a");
    assert.strictEqual(expired.length, 0);
    t.mock.timers.tick(STREAM_CLEANUP_MS);
    assert.deepStrictEqual(expired, ["stream-a"]);
  } finally {
    t.mock.timers.reset();
  }
});

test("progress slides the window so an active stream never expires mid-generation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const expired = [];
    const expiry = createSlidingExpiry({
      timeoutMs: STREAM_CLEANUP_MS,
      onExpire: (id) => expired.push(id),
    });
    expiry.schedule("stream-long");
    // Simulate 10 minutes of steady chunk progress: each chunk reschedules.
    for (let minute = 0; minute < 10; minute++) {
      t.mock.timers.tick(60 * 1000);
      assert.deepStrictEqual(expired, [], `expired at minute ${minute + 1}`);
      expiry.schedule("stream-long");
    }
    // After progress stops, one final window still reclaims it.
    t.mock.timers.tick(STREAM_CLEANUP_MS);
    assert.deepStrictEqual(expired, ["stream-long"]);
  } finally {
    t.mock.timers.reset();
  }
});

test("rescheduling replaces the pending timer instead of stacking", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let calls = 0;
    const expiry = createSlidingExpiry({
      timeoutMs: STREAM_CLEANUP_MS,
      onExpire: () => calls++,
    });
    expiry.schedule("s");
    t.mock.timers.tick(STREAM_CLEANUP_MS - 1000);
    expiry.schedule("s");
    t.mock.timers.tick(STREAM_CLEANUP_MS - 1000);
    assert.strictEqual(calls, 0, "stale timer must have been cancelled");
    t.mock.timers.tick(1000);
    assert.strictEqual(calls, 1, "exactly one expiry fires");
  } finally {
    t.mock.timers.reset();
  }
});

test("cancel stops expiry", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let calls = 0;
    const expiry = createSlidingExpiry({
      timeoutMs: STREAM_CLEANUP_MS,
      onExpire: () => calls++,
    });
    expiry.schedule("s");
    expiry.cancel("s");
    t.mock.timers.tick(STREAM_CLEANUP_MS + 1000);
    assert.strictEqual(calls, 0);
  } finally {
    t.mock.timers.reset();
  }
});

const EXPECTED_EXPIRED_FRAGMENTS = [
  "its stream expired",
  "Try summarizing again.",
];

// Wiring guards: the sliding timer only helps if every progress path
// actually reschedules. These mirror the style of offscreenKeepAlive.test.js.
test("offscreen extends cleanup on chunk progress and schedules at creation", () => {
  const code = readSource("../../offscreen/offscreen.js", import.meta.url);
  const emitStart = code.indexOf("const emit = (msg) => {");
  assert.ok(emitStart !== -1, "runStream emit helper exists");
  const emitBody = code.slice(emitStart, emitStart + 1200);
  assert.ok(
    emitBody.includes('msg.type === "chunk"') &&
      emitBody.includes("scheduleStreamCleanup(streamId)"),
    "offscreen chunk path reschedules cleanup (heartbeat)",
  );
  assert.ok(
    code.includes(
      "streams.set(streamId, stream);\n          scheduleStreamCleanup(streamId);",
    ),
    "offscreen schedules cleanup when the stream is created",
  );
  assert.ok(
    code.includes("disconnectStreamPorts(stream)"),
    "offscreen expiry and cancel share the disconnect helper",
  );
  assert.ok(
    EXPECTED_EXPIRED_FRAGMENTS.every((fragment) => code.includes(fragment)),
    "offscreen keeps the existing retry message for genuinely expired streams",
  );
});

test("service worker extends cleanup on local chunks and relayed chunks", () => {
  const code = readSource(
    "../../background/service-worker.js",
    import.meta.url,
  );
  const emitStart = code.indexOf("const emitChunk = (text) =>");
  assert.ok(emitStart !== -1, "createBufferedStream emitChunk exists");
  const emitBody = code.slice(emitStart, emitStart + 600);
  assert.ok(
    emitBody.includes("emitChunkToState") &&
      emitBody.includes("scheduleStreamCleanup(streamId)"),
    "local-stream chunk path reschedules the cleanup alarm (heartbeat)",
  );
  const relayStart = code.indexOf("function relayToOffscreenStream");
  assert.ok(relayStart !== -1, "offscreen relay helper exists");
  const relayBody = code.slice(relayStart, relayStart + 1500);
  assert.ok(
    relayBody.includes('msg.type === "chunk"') &&
      relayBody.includes("scheduleStreamCleanup(streamId)"),
    "relayed offscreen chunks reschedule the registered-job alarm",
  );
  assert.ok(
    EXPECTED_EXPIRED_FRAGMENTS.every((fragment) => code.includes(fragment)),
    "worker keeps the existing retry message for genuinely expired streams",
  );
});

test("service worker cleanup alarm terminates subscribers before deleting stream state", () => {
  const code = readSource(
    "../../background/service-worker.js",
    import.meta.url,
  );
  const handlerMatch = code.match(
    /function expireStreamForCleanup\(streamId\) \{[\s\S]*?\n\}/,
  );
  assert.ok(handlerMatch, "cleanup expiry helper exists");
  const handlerBody = handlerMatch[0];
  for (const [needle, message] of [
    ["activeStreams.get(streamId)", "expiry reads the stream before deletion"],
    [
      "disconnectStreamPorts(stream)",
      "expiry disconnects popup subscribers before dropping stream state",
    ],
    [
      "registeredStreamJobs.delete(streamId)",
      "expiry still removes registered stream jobs",
    ],
  ]) {
    assert.ok(handlerBody.includes(needle), message);
  }
  assert.ok(
    handlerBody.includes('type: "error"') &&
      handlerBody.includes("EXPIRED_STREAM_ERROR"),
    "expiry broadcasts a terminal expired-stream error",
  );
  assert.ok(
    handlerBody.indexOf("disconnectStreamPorts(stream)") <
      handlerBody.indexOf("activeStreams.delete(streamId)"),
    "subscriber disconnect happens before active stream deletion",
  );
});

test("broadcast copies the subscriber set before iterating", () => {
  const code = readSource("../../lib/util/streamBroadcast.js", import.meta.url);
  assert.ok(
    code.includes("[...stream.subscribers]"),
    "broadcast iterates a copy so mid-broadcast disconnects skip nobody",
  );
});

test("shared chunk helper heartbeats on every accepted chunk", () => {
  const code = readSource("../../lib/util/streamState.js", import.meta.url);
  const helperStart = code.indexOf("export function emitChunkToState");
  assert.ok(helperStart !== -1, "shared emitChunkToState helper exists");
  const helperBody = code.slice(helperStart, helperStart + 800);
  assert.ok(
    helperBody.includes("broadcastToStream(stream,") &&
      helperBody.includes("scheduleCleanup()"),
    "shared chunk path broadcasts and reschedules cleanup (heartbeat)",
  );
});
