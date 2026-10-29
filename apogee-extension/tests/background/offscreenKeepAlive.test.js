import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- Offscreen relay keep-alive ---
//
// WebLLM / Transformers jobs run in the offscreen document, so they have no
// entry in the service worker's `activeStreams`. The keep-alive used to only
// look at `activeStreams`, so the worker slept ~30s into a multi-minute
// local generation: the relay ports died and the popup froze on its spinner
// while the offscreen job kept running to completion (the full text only
// appeared after closing and reopening, via the saved view state).

const { chrome, getMessageListeners } = createExtensionApiMock({
  settings: {
    saveHistory: true,
    responseFormat: "bullets",
    summaryLanguage: "auto",
    customInstructions: "",
    translationEngine: "opus",
    provider: "webllm",
    webllmModel: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
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

globalThis.chrome = chrome;

const {
  offscreenRelayInflight,
  trackOffscreenRelay,
  untrackOffscreenRelay,
  hasWorkInFlight,
} = await import("../../background/service-worker.js");

test("offscreen relay counts as work in flight for the keep-alive", () => {
  offscreenRelayInflight.clear();
  assert.strictEqual(
    hasWorkInFlight(),
    false,
    "idle worker reports no work in flight",
  );

  trackOffscreenRelay("webllm-abc");
  assert.ok(
    offscreenRelayInflight.has("webllm-abc"),
    "relayed stream is tracked",
  );
  assert.strictEqual(
    hasWorkInFlight(),
    true,
    "tracked relay keeps the worker awake",
  );

  // Each viewer owns a reference until its relay ends.
  trackOffscreenRelay("webllm-abc");
  assert.strictEqual(offscreenRelayInflight.get("webllm-abc"), 2);

  assert.strictEqual(untrackOffscreenRelay("webllm-abc"), false);
  assert.strictEqual(offscreenRelayInflight.get("webllm-abc"), 1);
  assert.strictEqual(hasWorkInFlight(), true);
  assert.strictEqual(untrackOffscreenRelay("webllm-abc"), true);
  assert.strictEqual(untrackOffscreenRelay("webllm-abc"), false);
  assert.strictEqual(offscreenRelayInflight.size, 0);
  assert.strictEqual(
    hasWorkInFlight(),
    false,
    "finished relay lets the worker sleep again",
  );
});

test("track/untrack ignore empty stream ids", () => {
  offscreenRelayInflight.clear();
  trackOffscreenRelay(null);
  trackOffscreenRelay("");
  assert.strictEqual(offscreenRelayInflight.size, 0);
  assert.strictEqual(untrackOffscreenRelay(undefined), false);
  assert.strictEqual(hasWorkInFlight(), false);
});

test("stream-finished clears every relay reference only for the completed stream", () => {
  offscreenRelayInflight.clear();
  trackOffscreenRelay("webllm-finished");
  trackOffscreenRelay("webllm-finished");
  trackOffscreenRelay("transformers-running");

  const message = {
    target: "service-worker",
    type: "stream-finished",
    streamId: "webllm-finished",
  };
  for (const listener of getMessageListeners()) {
    listener(message, { id: chrome.runtime.id }, () => {});
  }

  assert.strictEqual(offscreenRelayInflight.has("webllm-finished"), false);
  assert.strictEqual(offscreenRelayInflight.get("transformers-running"), 1);
  assert.strictEqual(hasWorkInFlight(), true);
  assert.strictEqual(untrackOffscreenRelay("webllm-finished"), false);

  for (const listener of getMessageListeners()) {
    listener(message, { id: chrome.runtime.id }, () => {});
  }
  assert.strictEqual(offscreenRelayInflight.get("transformers-running"), 1);
  assert.strictEqual(untrackOffscreenRelay("transformers-running"), true);
  assert.strictEqual(hasWorkInFlight(), false);
});
