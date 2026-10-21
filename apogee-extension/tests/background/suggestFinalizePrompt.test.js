import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- #498: fresh summaries must use the same focus and instructions ---
//
// The suggest-questions key scopes the reader's focus keyword and custom
// instructions, and the prompt now uses both. Fresh popup summaries run the
// suggest job from finalize, so the trusted finalize object must carry those
// fields into runSuggestQuestionsJob; otherwise the prompt still ignores a
// key dimension for the main path.

const { chrome } = createExtensionApiMock({
  settings: {
    saveHistory: true,
    responseFormat: "bullets",
    summaryLanguage: "auto",
    customInstructions: "Ask about the trade-offs",
    translationEngine: "opus",
    provider: "webllm",
    webllmModel: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    ollamaHost: "http://127.0.0.1:11434",
  },
});

const sentMessages = [];
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
  create: async (id) => id,
  onClicked: { addListener: () => {} },
  onClosed: { addListener: () => {} },
};
chrome.action = {};

globalThis.chrome = chrome;

const { buildTrustedFinalize, finalizeSummaryJob } =
  await import("../../background/finalize.js");

const url = "https://example.com/article-498";
const model = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const focusKeyword = "battery pricing";
const customInstructions = "Ask about the trade-offs";

async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

test("finalize carries focus and instructions into the suggest job (#498)", async () => {
  sentMessages.length = 0;

  const trusted = await buildTrustedFinalize({
    url,
    title: "Example",
    model,
    content: "Article text.",
    focusKeyword,
  });
  assert.ok(trusted, "trusted finalize is built");
  assert.strictEqual(trusted.customInstructions, customInstructions);
  assert.strictEqual(trusted.focusKeyword, focusKeyword);

  // Keep this test off the storage and embedding path; the suggest job is
  // the target.
  trusted.persist = false;

  const result = await finalizeSummaryJob(
    {
      finalize: trusted,
      model,
      title: "Example",
      url,
      text: "A finished summary.",
    },
    { ensureOffscreenDocument: async () => {} },
  );
  assert.strictEqual(result.ok, true);

  const suggest = await waitFor(() =>
    sentMessages.some(
      (msg) =>
        msg?.target === "offscreen" && msg?.action === "suggest-questions",
    ),
  );
  assert.ok(suggest, "the suggest job reaches the offscreen document");

  const payload = sentMessages.find(
    (msg) => msg?.target === "offscreen" && msg?.action === "suggest-questions",
  ).payload;
  assert.strictEqual(payload.customInstructions, customInstructions);
  assert.strictEqual(payload.focusKeyword, focusKeyword);
});
