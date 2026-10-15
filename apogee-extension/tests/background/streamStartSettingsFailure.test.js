import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- #466: a prefs-load failure at stream start must end the stream ---
//
// startLocalHttpStream and startTransformersStream used to await
// getSettings() before their try block. The stream was already registered
// and its id already handed to the popup, so a storage failure rejected
// with no finish() call: the popup stayed on its spinner with no word.
// The load now sits inside the run's try, so the failure finishes the
// stream with a terminal error instead.

const { chrome } = createExtensionApiMock({ settings: {} });
chrome.scripting = {
  executeScript: async () => [{ result: null }],
};
// finish() slides the stream-cleanup alarm on every terminal message.
chrome.alarms = {
  create: async () => {},
  clear: async () => {},
};

// Fail settings reads only once inside the stream starters: the message
// router itself loads settings first (inside its own try, which answers
// the popup), so only a failure after stream registration hangs.
const STREAM_START_FRAMES = [
  "startLocalHttpStream",
  "startTransformersStream",
];
const realStorageGet = chrome.storage.local.get.bind(chrome.storage.local);
chrome.storage.local.get = async (...args) => {
  const stack = new Error().stack || "";
  if (STREAM_START_FRAMES.some((frame) => stack.includes(frame))) {
    throw new Error("Simulated settings storage failure");
  }
  return realStorageGet(...args);
};

const routerListeners = [];
const realAddListener = chrome.runtime.onMessage.addListener;
chrome.runtime.onMessage.addListener = (fn) => {
  routerListeners.push(fn);
  realAddListener(fn);
};
globalThis.chrome = chrome;

await import("../../background/service-worker.js");
const { activeStreams } = await import("../../background/streams.js");

assert.ok(
  routerListeners.length > 0,
  "service worker must register its message router",
);
const router = routerListeners[0];
const SENDER = { id: "mock-extension-id-12345" };

async function waitForNewStream(before, label) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const streamId = [...activeStreams.keys()].find((id) => !before.has(id));
    if (streamId) return streamId;
    if (Date.now() > deadline) {
      assert.fail(`${label}: router never registered a stream`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForStream(streamId, label) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const stream = activeStreams.get(streamId);
    if (stream?.done) return stream;
    if (Date.now() > deadline) {
      assert.fail(`${label}: stream ${streamId} never reached a terminal state`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function startPayload(extra = {}) {
  return {
    action: "summarize",
    title: "Example Article",
    url: "https://example.com/article",
    content: "Article body text, long enough to summarize.",
    mode: "bullets",
    type: "article",
    model: "llama3",
    language: "en",
    translationEngine: "off",
    focusKeyword: "",
    finalize: { jobId: `summary-${Date.now()}`, tabId: 101 },
    ...extra,
  };
}

test("ollama-stream ends the stream when settings fail to load (#466)", async () => {
  const before = new Set(activeStreams.keys());
  router(
    {
      target: "service-worker",
      action: "ollama-stream",
      payload: startPayload({ host: "http://127.0.0.1:11434" }),
    },
    SENDER,
    () => {},
  );
  const streamId = await waitForNewStream(before, "ollama-stream");
  assert.ok(streamId, "router must register a stream before the failure");
  const stream = await waitForStream(streamId, "ollama-stream");
  assert.strictEqual(typeof stream.error, "string");
  assert.ok(stream.error.length > 0, "terminal error must say something");
});

test("transformers-stream ends the stream when settings fail to load (#466)", async () => {
  const before = new Set(activeStreams.keys());
  router(
    {
      target: "service-worker",
      action: "transformers-stream",
      payload: startPayload(),
    },
    SENDER,
    () => {},
  );
  const streamId = await waitForNewStream(before, "transformers-stream");
  assert.ok(streamId, "router must register a stream before the failure");
  const stream = await waitForStream(streamId, "transformers-stream");
  assert.strictEqual(typeof stream.error, "string");
  assert.ok(stream.error.length > 0, "terminal error must say something");
});
