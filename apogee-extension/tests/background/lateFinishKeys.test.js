import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

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

await import("../../background/service-worker.js");
const { registerStreamJob, expireStreamForCleanup, registeredStreamJobs } =
  await import("../../background/streams.js");

const router = getMessageListeners()[0];

function makeJob(cacheKey) {
  return {
    model: "model-x",
    title: "Example",
    url: "https://example.com/article",
    finalize: {
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
      jobId: "job-545",
      windowId: 1,
      language: "auto",
      translationEngine: "off",
    },
  };
}

async function waitFor(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

test("late stream-finished saves under the keys captured at run start (#545)", async () => {
  const streamId = "summary-late-1";
  registerStreamJob(streamId, makeJob("summary:original-key"));

  expireStreamForCleanup(streamId);
  assert.strictEqual(registeredStreamJobs.has(streamId), false);

  router(
    {
      target: "service-worker",
      type: "stream-finished",
      streamId,
      text: "Late finished summary.",
      model: "other-model",
      title: "Other",
      url: "https://example.com/other",
      finalize: { cacheKey: "summary:rebuilt-key", persist: true },
    },
    { id: "mock-extension-id-12345" },
    () => {},
  );

  assert.ok(
    await waitFor(() => savedKeys.includes("summary:original-key")),
    "summary is saved under the original cache key",
  );
  assert.ok(
    !savedKeys.includes("summary:rebuilt-key"),
    "no save under a key rebuilt from current settings",
  );

  // The retained job is consumed once, so a second finish for the same id
  // cannot restore the expired payload.
  const savedCountAfterFirstFinish = savedKeys.filter(
    (key) => key === "summary:original-key",
  ).length;
  router(
    {
      target: "service-worker",
      type: "stream-finished",
      streamId,
      text: "Duplicate late finish.",
      model: "other-model",
      title: "Other",
      url: "https://example.com/other",
    },
    { id: "mock-extension-id-12345" },
    () => {},
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(
    savedKeys.filter((key) => key === "summary:original-key").length,
    savedCountAfterFirstFinish,
  );
});

test("the retained job is not taken when a live job with the same id exists (#545)", async () => {
  const streamId = "summary-reused-1";
  registerStreamJob(streamId, makeJob("summary:expired-key"));
  expireStreamForCleanup(streamId);

  // A new run reuses the id while the expired payload is still retained.
  registerStreamJob(streamId, makeJob("summary:live-key"));

  router(
    {
      target: "service-worker",
      type: "stream-finished",
      streamId,
      text: "Live run summary.",
      model: "other-model",
      title: "Other",
      url: "https://example.com/other",
    },
    { id: "mock-extension-id-12345" },
    () => {},
  );

  assert.ok(
    await waitFor(() => savedKeys.includes("summary:live-key")),
    "the live job wins over the retained one",
  );
  assert.ok(
    !savedKeys.includes("summary:expired-key"),
    "the retained job is not used for a live run",
  );
});

test("a finish with no job record at all still does not throw (#545)", async () => {
  router(
    {
      target: "service-worker",
      type: "stream-finished",
      streamId: "summary-unknown",
      text: "x",
    },
    { id: "mock-extension-id-12345" },
    () => {},
  );
  await new Promise((r) => setTimeout(r, 50));
});
