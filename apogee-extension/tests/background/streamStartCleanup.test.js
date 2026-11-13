import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { waitForNewStream } from "../helpers/streamTestUtils.js";
import {
  MIN_ALARM_DELAY_MINUTES,
  STREAM_CLEANUP_MS,
} from "../../lib/util/streamExpiry.js";

// --- #544: a local Ask run that hangs before its first token ---
//
// createBufferedStream registered the stream and started the keep-alive but
// only scheduled the cleanup alarm on the first chunk or on finish. When the
// engine never sent a token, the stream stayed in activeStreams, the worker
// stayed awake forever, and the popup spun until the worker was stopped.
// The cleanup deadline must be set when the stream is created.

const { chrome, getMessageListeners } = createExtensionApiMock({
  settings: {
    provider: "ollama",
    ollamaHost: "http://127.0.0.1:11434",
    saveHistory: true,
    responseFormat: "bullets",
    summaryLanguage: "en",
    translationEngine: "off",
  },
});

const alarms = [];
let onAlarm;
chrome.alarms = {
  create: (name, options) => {
    alarms.push({ name, ...options });
  },
  clear: async () => {},
  onAlarm: {
    addListener: (listener) => {
      onAlarm = listener;
    },
  },
};
chrome.notifications = {
  create: async (id) => id,
  onClicked: { addListener: () => {} },
  onClosed: { addListener: () => {} },
};
chrome.action = {};

// A request that never resolves and never yields a token.
globalThis.fetch = () => new Promise(() => {});

globalThis.chrome = chrome;

const { createBufferedStream } =
  await import("../../background/service-worker.js");
const {
  activeStreams,
  expireStreamForCleanup,
  hasWorkInFlight,
  STREAM_CLEANUP_PREFIX,
} = await import("../../background/streams.js");

const routerListeners = getMessageListeners();
assert.ok(
  routerListeners.length > 0,
  "service worker must register its message router",
);
const router = routerListeners[0];

test("a local Ask start with no chunks still gets a cleanup deadline", async () => {
  const before = new Set(activeStreams.keys());
  router(
    {
      target: "service-worker",
      action: "ollama-stream",
      payload: {
        action: "ask",
        title: "Example Article",
        url: "https://example.com/article",
        content: "Short article body.",
        question: "What is this about?",
        mode: "bullets",
        type: "article",
        model: "llama3",
        language: "en",
        translationEngine: "off",
        focusKeyword: "",
        host: "http://127.0.0.1:11434",
      },
    },
    { id: "mock-extension-id-12345" },
    () => {},
  );

  const streamId = await waitForNewStream(activeStreams, before);
  assert.ok(
    alarms.some(({ name }) => name === `${STREAM_CLEANUP_PREFIX}${streamId}`),
    "cleanup alarm must be scheduled when the stream is created",
  );
  assert.strictEqual(
    hasWorkInFlight(),
    true,
    "the hanging stream counts as work in flight",
  );

  // Reclaiming the expired stream drops it from the registry so the
  // keep-alive can stop instead of holding the worker open forever.
  expireStreamForCleanup(streamId);
  assert.strictEqual(activeStreams.has(streamId), false);
  assert.strictEqual(hasWorkInFlight(), false);
});

test("a chunk burst keeps the original alarm and slides expiry to the last chunk (#640)", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.method(performance, "now", Date.now.bind(Date));
  const streamId = "burst";
  const name = STREAM_CLEANUP_PREFIX + streamId;
  const { stream, emitChunk } = createBufferedStream(streamId, {});
  const scheduled = () => alarms.filter((alarm) => alarm.name === name);
  t.after(() => expireStreamForCleanup(streamId));

  t.mock.timers.tick(45_000);
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(10);
    emitChunk("word ");
  }
  assert.strictEqual(scheduled().length, 1);

  t.mock.timers.tick(STREAM_CLEANUP_MS - 45_200);
  onAlarm({ name });
  assert.strictEqual(activeStreams.get(streamId), stream);
  assert.strictEqual(stream.controller.signal.aborted, false);
  assert.deepStrictEqual(
    scheduled().map((alarm) => alarm.delayInMinutes),
    [STREAM_CLEANUP_MS / 60_000, 45_200 / 60_000],
  );

  t.mock.timers.tick(45_200);
  onAlarm({ name });
  assert.strictEqual(activeStreams.has(streamId), false);
  assert.strictEqual(stream.controller.signal.aborted, true);
  assert.strictEqual(scheduled().length, 2);
});

test("worker alarm recheck respects the browser minimum delay (#640)", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.method(performance, "now", Date.now.bind(Date));
  const streamId = "short-extension";
  const name = STREAM_CLEANUP_PREFIX + streamId;
  const { stream, emitChunk } = createBufferedStream(streamId, {});
  t.after(() => expireStreamForCleanup(streamId));

  t.mock.timers.tick(1000);
  emitChunk("word ");
  t.mock.timers.tick(STREAM_CLEANUP_MS - 1000);
  onAlarm({ name });
  assert.strictEqual(activeStreams.get(streamId), stream);
  assert.strictEqual(alarms.at(-1).delayInMinutes, MIN_ALARM_DELAY_MINUTES);

  t.mock.timers.tick(MIN_ALARM_DELAY_MINUTES * 60_000);
  onAlarm({ name });
  assert.strictEqual(activeStreams.has(streamId), false);
});

test("worker cleanup uses elapsed time across wall-clock changes (#640)", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const elapsed = Date.now.bind(Date);
  t.mock.method(performance, "now", elapsed);
  const streamId = "clock-change";
  const name = STREAM_CLEANUP_PREFIX + streamId;
  const { stream, emitChunk } = createBufferedStream(streamId, {});
  t.after(() => expireStreamForCleanup(streamId));

  t.mock.timers.tick(90_000);
  emitChunk("word ");

  let wallClockOffset = 3_600_000;
  t.mock.method(Date, "now", () => elapsed() + wallClockOffset);
  t.mock.timers.tick(30_000);
  onAlarm({ name });
  assert.strictEqual(activeStreams.get(streamId), stream);
  assert.strictEqual(alarms.at(-1).delayInMinutes, 1.5);

  wallClockOffset = -3_600_000;
  t.mock.timers.tick(90_000);
  onAlarm({ name });
  assert.strictEqual(activeStreams.has(streamId), false);
  assert.strictEqual(stream.controller.signal.aborted, true);
});
