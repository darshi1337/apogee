import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { OFFSCREEN_UNRESPONSIVE_ERROR_CODE } from "../../lib/constants.js";
import { OFFSCREEN_UNRESPONSIVE_ERROR_MSG } from "../../lib/util/messages.js";

// --- #469: calls into the model document have no time cap ---
//
// The worker awaits chrome.runtime.sendMessage({ target: "offscreen" }) with
// no deadline. A model document that is alive but never answers (stuck
// engine load, wedged GPU device) leaves the popup on its spinner for good,
// because the router only replies once that await settles.

const { chrome, getMessageListeners } = createExtensionApiMock({
  settings: {
    provider: "webllm",
    saveHistory: true,
    responseFormat: "bullets",
    summaryLanguage: "en",
    translationEngine: "off",
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
chrome.offscreen = { createDocument: async () => {} };
chrome.runtime.getContexts = async () => [
  { contextType: "OFFSCREEN_DOCUMENT" },
];

// The document exists but never answers; every other message keeps the
// default mock routing.
const routeToListeners = chrome.runtime.sendMessage;
const offscreenActions = [];
chrome.runtime.sendMessage = (...args) => {
  const [msg] = args;
  if (msg?.target !== "offscreen") return routeToListeners(...args);
  offscreenActions.push(msg.action);
  return new Promise(() => {});
};

globalThis.chrome = chrome;

await import("../../background/service-worker.js");

const router = getMessageListeners()[0];
assert.ok(router, "service worker must register its message router");

const flush = () => new Promise((resolve) => setImmediate(resolve));

function assertUnresponsiveError(response, action) {
  assert.ok(
    response,
    `the popup must get a reply for "${action}" instead of hanging`,
  );
  assert.strictEqual(response.error, OFFSCREEN_UNRESPONSIVE_ERROR_MSG);
  assert.strictEqual(response.userFacing, true);
  assert.strictEqual(response.code, OFFSCREEN_UNRESPONSIVE_ERROR_CODE);
}

async function callRouter(t, message) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let response;
  router(message, { id: chrome.runtime.id }, (res) => {
    response = res;
  });
  // Let ensureOffscreenDocument settle so the offscreen call is in flight
  // before the clock moves.
  for (let i = 0; i < 5; i++) await flush();
  assert.ok(
    offscreenActions.includes(message.action),
    `the worker must reach the model document for "${message.action}"`,
  );
  t.mock.timers.tick(10 * 60 * 1000);
  for (let i = 0; i < 5; i++) await flush();
  return response;
}

test("a status request to a silent model document answers with an error", async (t) => {
  const response = await callRouter(t, {
    target: "service-worker",
    action: "status",
  });
  assertUnresponsiveError(response, "status");
});

test("starting a WebLLM Ask against a silent model document answers with an error", async (t) => {
  const response = await callRouter(t, {
    target: "service-worker",
    action: "ask",
    payload: {
      title: "Example Article",
      url: "https://example.com/article",
      content: "Short article body.",
      question: "What is this about?",
      model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      language: "en",
      translationEngine: "off",
    },
  });
  assertUnresponsiveError(response, "ask");
});
