import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- #631: the save must outlive the stream ---
//
// finish() marks a buffered stream done before its finalize starts, and the
// stream-finished handler clears the offscreen relay refs before its save.
// Both used to leave hasWorkInFlight() false while the storage write was
// still pending, so the 20s keep-alive could stop and the worker could sleep
// mid-save. A finalize now counts as work in flight until the save settles.

const { chrome, getMessageListeners } = createExtensionApiMock({
  settings: {
    saveHistory: true,
    responseFormat: "bullets",
    summaryLanguage: "auto",
    customInstructions: "",
    translationEngine: "off",
    provider: "webllm",
    webllmModel: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    ollamaHost: "http://127.0.0.1:11434",
  },
});

chrome.alarms = {
  create: () => {},
  clear: async () => {},
  onAlarm: { addListener: () => {} },
};
chrome.notifications = {
  create: async (id) => id,
  onClicked: { addListener: () => {} },
  onClosed: { addListener: () => {} },
};
chrome.action = {};

const storageSet = chrome.storage.local.set.bind(chrome.storage.local);
let pendingGate = null;

chrome.storage.local.set = async (items) => {
  if (pendingGate && Object.hasOwn(items, pendingGate.key)) {
    const gate = pendingGate;
    pendingGate = null;
    gate.markBlocked();
    await gate.promise;
  }
  return storageSet(items);
};

globalThis.chrome = chrome;

const { createBufferedStream } =
  await import("../../background/service-worker.js");
const { hasWorkInFlight, registerStreamJob } =
  await import("../../background/streams.js");

const router = getMessageListeners()[0];
const SENDER = { id: chrome.runtime.id };

// Hold the first storage write for `key`, and report when it is reached so a
// test can assert the state while the write is genuinely pending.
function deferSetFor(key) {
  let release;
  let markBlocked;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  const blocked = new Promise((resolve) => {
    markBlocked = resolve;
  });
  pendingGate = { key, promise, markBlocked, release };
  return { blocked, release };
}

test.afterEach(() => {
  pendingGate?.release();
  pendingGate = null;
});

function makeFinalize(cacheKey) {
  return {
    cacheKey,
    promptsCacheKey: "",
    persist: true,
    persistUrl: "https://example.com/article",
    isSelection: false,
    providerType: "webllm",
    notifyOnFinish: false,
    sensitive: false,
    tabId: 1,
    jobId: "job-631",
    windowId: 1,
    language: "auto",
    translationEngine: "off",
  };
}

function makeJob(cacheKey) {
  return {
    model: "model-x",
    title: "Example",
    url: "https://example.com/article",
    finalize: makeFinalize(cacheKey),
  };
}

async function waitFor(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

test("a buffered stream stays in flight until its save resolves (#631)", async () => {
  const streamId = "summary-save-buffered";
  const cacheKey = "summary:pending-buffered";
  const { blocked, release } = deferSetFor(cacheKey);
  const { stream, finish } = createBufferedStream(streamId, {
    finalize: makeFinalize(cacheKey),
    model: "model-x",
    title: "Example",
    url: "https://example.com/article",
  });

  finish({ type: "done" });
  assert.strictEqual(stream.done, true, "the stream itself is finished");
  assert.strictEqual(
    hasWorkInFlight(),
    true,
    "a done stream with a pending save is still work in flight",
  );

  await blocked;
  assert.strictEqual(
    hasWorkInFlight(),
    true,
    "the worker stays awake while the save write is blocked",
  );

  release();
  assert.ok(
    await waitFor(() => !hasWorkInFlight()),
    "the keep-alive can stop after the save settles",
  );
});

test("stream-finished stays in flight until its save resolves (#631)", async () => {
  const streamId = "summary-save-message";
  const cacheKey = "summary:pending-message";
  registerStreamJob(streamId, makeJob(cacheKey));
  const { blocked, release } = deferSetFor(cacheKey);

  router(
    {
      target: "service-worker",
      type: "stream-finished",
      streamId,
      text: "Finished summary.",
      model: "model-x",
      title: "Example",
      url: "https://example.com/article",
      finalize: { cacheKey: "summary:rebuilt-by-message", persist: true },
    },
    SENDER,
    () => {},
  );

  assert.strictEqual(
    hasWorkInFlight(),
    true,
    "cleared relay refs must not end the keep-alive before the save",
  );

  await blocked;
  assert.strictEqual(
    hasWorkInFlight(),
    true,
    "the worker stays awake while the save write is blocked",
  );

  release();
  assert.ok(
    await waitFor(() => !hasWorkInFlight()),
    "the keep-alive can stop after the save settles",
  );
});
