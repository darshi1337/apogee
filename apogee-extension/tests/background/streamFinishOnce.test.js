import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { createCollectingPort } from "../helpers/streamTestUtils.js";

// --- #628: one finish per stream ---
//
// Cleanup marks a reclaimed stream done, but finish() only skipped cancelled
// streams. A late finish could broadcast another done and finalize the same
// job again. A terminal stream now rejects every later finish, and the
// stream-finished handler claims each stream id once.

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

const savedKeys = [];
const backingSet = chrome.storage.local.set.bind(chrome.storage.local);
chrome.storage.local.set = async (obj) => {
  savedKeys.push(...Object.keys(obj));
  return backingSet(obj);
};
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
globalThis.chrome = chrome;

const { createBufferedStream } =
  await import("../../background/service-worker.js");
const { expireStreamForCleanup, registerStreamJob } =
  await import("../../background/streams.js");

const router = getMessageListeners()[0];
const SENDER = { id: "mock-extension-id-12345" };

function makeFinalize(cacheKey) {
  return {
    cacheKey,
    promptsCacheKey: `suggested-prompts:${cacheKey}`,
    persist: true,
    persistUrl: "https://example.com/article",
    isSelection: false,
    providerType: "webllm",
    host: "http://127.0.0.1:11434",
    notifyOnFinish: false,
    sensitive: false,
    tabId: 1,
    jobId: "job-628",
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

function countSaves(cacheKey) {
  return savedKeys.filter((key) => key === cacheKey).length;
}

function countSummaryWrites() {
  return savedKeys.filter((key) => key.startsWith("summary:")).length;
}

async function waitFor(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a done stream ignores a second finish: one done, one save (#628)", async () => {
  const streamId = "summary-finish-twice";
  const cacheKey = "summary:finish-twice";
  const { stream, finish } = createBufferedStream(streamId, {
    finalize: makeFinalize(cacheKey),
    model: "model-x",
    title: "Example",
    url: "https://example.com/article",
  });
  const port = createCollectingPort();
  stream.subscribers.add(port);

  finish({ type: "done" });
  finish({ type: "done" });

  assert.ok(
    await waitFor(() => countSaves(cacheKey) === 1),
    "the first finish saves the summary",
  );
  await delay(100);
  assert.strictEqual(
    countSaves(cacheKey),
    1,
    "the second finish saves nothing",
  );
  assert.strictEqual(
    port.messages.filter((msg) => msg.type === "done").length,
    1,
    "the viewer receives one done",
  );
});

test("a late finish after cleanup sends no second terminal or save (#628)", async () => {
  const streamId = "summary-expired-finish";
  const cacheKey = "summary:expired-finish";
  const { stream, finish } = createBufferedStream(streamId, {
    finalize: makeFinalize(cacheKey),
    model: "model-x",
    title: "Example",
    url: "https://example.com/article",
  });
  const port = createCollectingPort();
  stream.subscribers.add(port);

  expireStreamForCleanup(streamId);
  assert.strictEqual(
    port.messages.filter((msg) => msg.type === "error").length,
    1,
    "cleanup ends the stream with one error",
  );

  // A viewer that reattaches before the late finish must not see a done for
  // a stream the worker already ended.
  stream.subscribers.add(port);

  finish({ type: "done" });
  await delay(100);

  assert.strictEqual(
    port.messages.filter((msg) => msg.type === "done").length,
    0,
    "the late finish broadcasts no done",
  );
  assert.strictEqual(
    countSaves(cacheKey),
    0,
    "the late finish does not save a stream cleanup already ended",
  );
});

test("a duplicate stream-finished with finalize does not save twice (#628)", async () => {
  const streamId = "summary-finish-message-twice";
  const cacheKey = "summary:finish-message-twice";
  registerStreamJob(streamId, makeJob(cacheKey));

  const message = {
    target: "service-worker",
    type: "stream-finished",
    streamId,
    finalize: { cacheKey: "summary:rebuilt-by-message", persist: true },
    text: "Finished summary.",
    model: "other-model",
    title: "Other",
    url: "https://example.com/other",
  };

  router(message, SENDER, () => {});
  assert.ok(
    await waitFor(() => countSaves(cacheKey) === 1),
    "the retained job saves once",
  );

  const writesAfterFirstFinish = countSummaryWrites();
  router(message, SENDER, () => {});
  await delay(100);

  assert.strictEqual(
    countSummaryWrites(),
    writesAfterFirstFinish,
    "the duplicate message adds no summary write",
  );
});

test("offscreen emit rejects work after a terminal state (#628)", () => {
  const code = fs.readFileSync(
    new URL("../../offscreen/offscreen.js", import.meta.url),
    "utf-8",
  );
  const emitStart = code.indexOf("const emit = (msg) => {");
  assert.ok(emitStart !== -1, "runStream emit helper exists");
  const emitBody = code.slice(emitStart, emitStart + 500);
  assert.ok(
    emitBody.includes("if (isStreamTerminal(stream)) return;"),
    "offscreen emit stops at done or cancel",
  );
});
