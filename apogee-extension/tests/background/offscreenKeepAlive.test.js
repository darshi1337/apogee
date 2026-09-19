import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- Offscreen relay keep-alive ---
//
// WebLLM / Transformers jobs run in the offscreen document, so they have no
// entry in the service worker's `activeStreams`. The keep-alive used to only
// look at `activeStreams`, so the worker slept ~30s into a multi-minute
// local generation: the relay ports died and the popup froze on its spinner
// while the offscreen job kept running to completion (the full text only
// appeared after closing and reopening, via the saved view state).

const { chrome } = createExtensionApiMock({
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

  // Tracking is idempotent: re-attaching the same stream changes nothing.
  trackOffscreenRelay("webllm-abc");
  assert.strictEqual(offscreenRelayInflight.size, 1);

  untrackOffscreenRelay("webllm-abc");
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
  untrackOffscreenRelay(undefined);
  assert.strictEqual(hasWorkInFlight(), false);
});

test("relay and finish paths wire tracking end to end", () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );
  const relayStart = swCode.indexOf("function relayToOffscreenStream");
  assert.ok(relayStart !== -1, "relay helper exists");
  const relayBody = swCode.slice(relayStart, relayStart + 2000);
  assert.ok(
    relayBody.includes("trackOffscreenRelay(streamId)"),
    "relay tracks the stream while a popup watches",
  );
  assert.ok(
    relayBody.includes('msg.type === "cancelled"'),
    "cancel delivery counts as a terminal relay message",
  );
  assert.ok(
    relayBody.match(/untrackOffscreenRelay\(streamId\)/g)?.length >= 3,
    "relay untracks on terminal message and on either port disconnecting",
  );
  assert.ok(
    swCode.includes("untrackOffscreenRelay(streamId)"),
    "stream-finished clears tracking as a safety net",
  );
});
