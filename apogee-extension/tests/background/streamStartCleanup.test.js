import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { waitForNewStream } from "../helpers/streamTestUtils.js";

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

const alarmNames = [];
chrome.alarms = {
  create: (name) => {
    alarmNames.push(name);
  },
  clear: async () => {},
  onAlarm: { addListener: () => {} },
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
    alarmNames.includes(`${STREAM_CLEANUP_PREFIX}${streamId}`),
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
