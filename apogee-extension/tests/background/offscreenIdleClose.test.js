import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- #632: idle close must not shut the document under a new run ---
//
// closeOffscreenIfIdle() checks for work, then awaits the document lookup and
// the has-active-streams reply before closing. A run that calls
// ensureOffscreenDocument() during those awaits used to lose the document
// mid-start. Keep the close away from any start, and make a start that lands
// during an actual close wait for it and create a fresh document.

const { chrome, getMessageListeners } = createExtensionApiMock({
  settings: {
    provider: "webllm",
    saveHistory: true,
    responseFormat: "bullets",
    summaryLanguage: "auto",
    customInstructions: "",
    translationEngine: "off",
    webllmModel: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    ollamaHost: "http://127.0.0.1:11434",
  },
});

let fakeNow = 1_700_000_000_000;
Date.now = () => fakeNow;

const state = {
  contexts: [],
  closeCalls: 0,
  createCalls: 0,
  activeAsked: false,
  activeReply: null,
  createGate: null,
  closeGate: null,
  offscreenMessages: [],
  alarms: [],
};

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

chrome.alarms = {
  create: (name, info) => state.alarms.push({ name, info }),
  clear: async () => {},
  onAlarm: { addListener: () => {} },
};
chrome.notifications = {
  create: async (id) => id,
  onClicked: { addListener: () => {} },
  onClosed: { addListener: () => {} },
};
chrome.action = {};
chrome.offscreen = {
  createDocument: async () => {
    state.createCalls += 1;
    if (state.createGate) await state.createGate.promise;
  },
  closeDocument: async () => {
    state.closeCalls += 1;
    if (state.closeGate) await state.closeGate.promise;
    state.contexts = [];
  },
};
chrome.runtime.getContexts = async () => state.contexts;

const routeMessage = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (msg) => {
  if (msg?.target !== "offscreen") return routeMessage(msg);
  state.offscreenMessages.push(msg);
  if (msg.action === "has-active-streams") {
    state.activeAsked = true;
    return state.activeReply
      ? state.activeReply.promise
      : Promise.resolve({ active: false });
  }
  return Promise.resolve({});
};

globalThis.chrome = chrome;

const { closeOffscreenIfIdle } =
  await import("../../background/service-worker.js");

const SENDER = { id: chrome.runtime.id };

function dispatch(message) {
  for (const listener of getMessageListeners()) {
    listener(message, SENDER, () => {});
  }
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test.beforeEach(() => {
  // Every test is an hour later, so a start from the previous test is no
  // longer inside the idle-close grace window.
  fakeNow += 60 * 60 * 1000;
  state.contexts = [{ contextType: "OFFSCREEN_DOCUMENT" }];
  state.closeCalls = 0;
  state.createCalls = 0;
  state.activeAsked = false;
  state.activeReply = null;
  state.createGate = null;
  state.closeGate = null;
  state.offscreenMessages.length = 0;
  state.alarms.length = 0;
});

function runRequested() {
  return state.offscreenMessages.some((msg) => msg.action === "ask");
}

test("idle close backs off when a run starts during the active-stream check", async () => {
  state.activeReply = deferred();
  const closePromise = closeOffscreenIfIdle();
  await waitFor(() => state.activeAsked, "has-active-streams");

  dispatch({ target: "service-worker", action: "ask", payload: {} });
  await waitFor(runRequested, "the new run to reach the document");

  state.activeReply.resolve({ active: false });
  await closePromise;

  assert.strictEqual(
    state.closeCalls,
    0,
    "the document must stay open for the run that started",
  );
  assert.ok(
    state.alarms.some((alarm) => alarm.name === "offscreen-idle-close"),
    "a skipped close is rescheduled",
  );
});

test("idle close skips while the document is being created", async () => {
  state.contexts = [];
  state.createGate = deferred();

  dispatch({ target: "service-worker", action: "ask", payload: {} });
  await waitFor(() => state.createCalls === 1, "createDocument");

  await closeOffscreenIfIdle();

  assert.strictEqual(
    state.closeCalls,
    0,
    "a start still creating the document is not idle",
  );

  state.createGate.resolve();
  dispatch({ target: "service-worker", type: "offscreen-ready" });
  await waitFor(runRequested, "the run to finish starting");
});

test("idle close backs off after a run claimed the document", async () => {
  dispatch({ target: "service-worker", action: "ask", payload: {} });
  await waitFor(runRequested, "the run to reach the document");

  await closeOffscreenIfIdle();

  assert.strictEqual(
    state.closeCalls,
    0,
    "a just-started run keeps the document open",
  );
});

test("a run that lands during close waits and creates a fresh document", async () => {
  state.closeGate = deferred();
  const closePromise = closeOffscreenIfIdle();
  await waitFor(() => state.closeCalls === 1, "closeDocument");

  dispatch({ target: "service-worker", action: "ask", payload: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(
    state.createCalls,
    0,
    "the run must not create a document over the closing one",
  );

  state.closeGate.resolve();
  await waitFor(() => state.createCalls === 1, "the replacement document");
  dispatch({ target: "service-worker", type: "offscreen-ready" });
  await waitFor(runRequested, "the run to reach the replacement");
  await closePromise;

  assert.strictEqual(state.closeCalls, 1);
});
