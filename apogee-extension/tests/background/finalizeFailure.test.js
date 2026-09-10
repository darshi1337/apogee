import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- #265: unhandled async finalize can silently lose summaries ---
//
// `finalizeSummaryJob` used to be fire-and-forget from both
// `createBufferedStream.finish` and the `stream-finished` handler, with no
// `.catch`. A storage-quota throw inside `persistSummaryIfAllowed` (or the
// suggest-questions cache write) became an unhandled rejection and the
// finished summary was silently lost. Finalize must now never reject: it
// preserves the buffered text for retry and surfaces a user-visible error.

const { chrome } = createExtensionApiMock({
  settings: {
    saveHistory: true,
    responseFormat: "bullets",
    summaryLanguage: "auto",
    customInstructions: "",
    translationEngine: "opus",
    provider: "webllm",
    webllmModel: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    ollamaHost: "http://127.0.0.1:11434",
  },
});

const sentMessages = [];
const notifications = [];
let quotaFailure = true;

const backingSet = chrome.storage.local.set.bind(chrome.storage.local);
chrome.storage.local.set = async (obj) => {
  if (quotaFailure && Object.keys(obj).some((k) => k.startsWith("summary:"))) {
    throw new Error("Quota exceeded");
  }
  return backingSet(obj);
};

const backingSend = chrome.runtime.sendMessage.bind(chrome.runtime);
chrome.runtime.sendMessage = async (msg) => {
  sentMessages.push(msg);
  try {
    return await backingSend(msg);
  } catch {
    return undefined;
  }
};

chrome.alarms = {
  create: () => {},
  clear: async () => {},
  onAlarm: { addListener: () => {} },
};
chrome.notifications = {
  create: async (id, opts) => {
    notifications.push({ id, opts });
    return id;
  },
  onClicked: { addListener: () => {} },
  onClosed: { addListener: () => {} },
};
chrome.action = {};

globalThis.chrome = chrome;

const {
  finalizeSummaryJob,
  pendingFinalizeRetries,
  takePendingFinalize,
  FINALIZE_FAILED_MESSAGE,
} = await import("../../background/service-worker.js");

function makeFinalize(overrides = {}) {
  return {
    cacheKey: "summary:test-quota-key",
    promptsCacheKey: "suggested-prompts:test-quota-key",
    persist: true,
    persistUrl: "https://example.com/article",
    isSelection: false,
    providerType: "webllm",
    host: "http://127.0.0.1:11434",
    notifyOnFinish: false,
    sensitive: false,
    tabId: 101,
    jobId: "job-quota-1",
    windowId: 1,
    language: "auto",
    translationEngine: "opus",
    ...overrides,
  };
}

test("quota throw during finalize never rejects and preserves text for retry (#265)", async () => {
  pendingFinalizeRetries.clear();
  sentMessages.length = 0;
  quotaFailure = true;

  const text = "Finished summary that must not be lost.";
  let result;
  try {
    result = await finalizeSummaryJob({
      finalize: makeFinalize(),
      model: "model-x",
      title: "Example",
      url: "https://example.com/article",
      text,
    });
  } catch (err) {
    assert.fail(
      `finalizeSummaryJob must not throw, but threw: ${err?.stack || err}`,
    );
  }

  assert.strictEqual(result?.ok, false, "result reports the failure");
  assert.ok(result?.error instanceof Error, "result carries the quota error");

  const pending = pendingFinalizeRetries.get("job-quota-1");
  assert.ok(pending, "buffered text is preserved for retry");
  assert.strictEqual(
    pending.text,
    text,
    "preserved text matches the finished summary",
  );
  assert.strictEqual(pending.title, "Example");

  const failed = sentMessages.find((m) => m?.type === "finalize-failed");
  assert.ok(failed, "a user-visible finalize-failed message is emitted");
  assert.strictEqual(failed.jobId, "job-quota-1");
  assert.strictEqual(failed.error, FINALIZE_FAILED_MESSAGE);

  // The pending entry is retrievable for a retry and cleared on take.
  const taken = takePendingFinalize("job-quota-1");
  assert.strictEqual(taken?.text, text);
  assert.strictEqual(pendingFinalizeRetries.has("job-quota-1"), false);
});

test("finalize succeeds without preserving when storage works (#265)", async () => {
  pendingFinalizeRetries.clear();
  sentMessages.length = 0;
  quotaFailure = false;

  const result = await finalizeSummaryJob({
    finalize: makeFinalize({ jobId: "job-ok-1" }),
    model: "model-x",
    title: "Example",
    url: "https://example.com/article",
    text: "summarized body",
  });

  assert.strictEqual(result?.ok, true, "happy path still resolves ok");
  assert.strictEqual(
    pendingFinalizeRetries.has("job-ok-1"),
    false,
    "nothing preserved on success",
  );
});

test("fire-and-forget finalize call sites are awaited with catch handlers (#265)", () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );
  assert.ok(
    swCode.includes("finalizeSummaryJob({"),
    "finalizeSummaryJob call sites exist",
  );
  assert.ok(
    swCode.includes("}).catch((err) => console.error("),
    "fire-and-forget finalize/suggest jobs attach .catch",
  );
  assert.ok(
    swCode.includes("stream-finished handler failed:"),
    "stream-finished IIFE has an outer .catch",
  );
  assert.ok(
    swCode.includes("finalize-failed"),
    "finalize failures surface a user-visible message",
  );
  assert.ok(
    swCode.includes("preservePendingFinalize("),
    "failed finalizes preserve buffered text",
  );
});
