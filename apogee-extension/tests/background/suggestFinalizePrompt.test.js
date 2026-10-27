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

const { buildTrustedFinalize, finalizeSummaryJob, recordPopupSummaryStream } =
  await import("../../background/finalize.js");
const { customContentPromptsCacheKey, getSummaryAndPromptsCacheKeys } =
  await import("../../ui/promptsContext.js");
const { saveViewState, loadViewState } =
  await import("../../lib/storage/viewState.js");

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

// --- #497: the UI and the trusted finalizer must agree on the prompts key ---
//
// The finalizer stores the questions; the UI listens on the key it computed.
// Provider and page type are part of the key, so a call site that omits them
// leaves the questions in an entry the UI never hears about.

test("a normal page's UI key equals the trusted finalizer's key (#497)", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const trusted = await buildTrustedFinalize({
    url,
    title: "Example",
    model,
    content: "Article text.",
    type: "article",
    focusKeyword,
    finalize: { pageType: "article" },
  });
  assert.ok(trusted, "trusted finalize is built");
  assert.strictEqual(trusted.pageType, "article");

  const ui = await getSummaryAndPromptsCacheKeys(
    url,
    settings,
    model,
    focusKeyword,
    { pageType: "article" },
  );
  assert.strictEqual(ui.promptsCacheKey, trusted.promptsCacheKey);
  assert.strictEqual(ui.cacheKey, trusted.cacheKey);
});

test("custom content: the UI key equals the trusted finalizer's key (#497)", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const content = "Pasted text for the custom-content key check.";
  const uiKey = await customContentPromptsCacheKey({
    url: "",
    content,
    settings,
    model,
  });
  const trusted = await buildTrustedFinalize({
    url: "",
    title: "Pasted Text",
    model,
    content,
    finalize: {
      customContent: true,
      pageType: "",
      tabId: 497,
      jobId: "custom-content-497",
    },
  });

  assert.ok(trusted, "trusted finalize is built");
  assert.strictEqual(trusted.pageType, "");
  assert.strictEqual(uiKey, trusted.promptsCacheKey);
});

test("a caller-supplied empty page type stays authoritative (#497)", async () => {
  const trusted = await buildTrustedFinalize({
    url,
    title: "Example",
    model,
    content: "Article text.",
    type: "article",
    finalize: { pageType: "" },
  });

  assert.ok(trusted, "trusted finalize is built");
  assert.strictEqual(
    trusted.pageType,
    "",
    "pasted content persists an empty page type meaningfully",
  );
});

test("recordPopupSummaryStream clears stale selection fields and defaults missing ones (#497)", async () => {
  const tabId = 4973;
  const jobId = "normal-after-selection-497";
  await saveViewState(tabId, {
    view: "summaryView",
    subview: "summarizing",
    url,
    streamId: null,
    jobId,
    isSelection: true,
    selectionText: "The old selection must not survive.",
    pageType: "selection",
    focusKeyword: "the old keyword",
  });

  await recordPopupSummaryStream(
    {
      model,
      title: "Example",
      url,
      finalize: {
        jobId,
        tabId,
        promptsCacheKey: "suggested-prompts:normal-key",
        language: "auto",
        translationEngine: "opus",
      },
    },
    "stream-normal-497",
  );

  const state = await loadViewState(tabId);
  assert.strictEqual(state.isSelection, false);
  assert.strictEqual(state.selectionText, "");
  assert.strictEqual(state.pageType, "");
  assert.strictEqual(state.focusKeyword, "");
});

test("recordPopupSummaryStream scrubs selection text when history is off (#497)", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...settings, saveHistory: false },
  });
  try {
    const tabId = 4975;
    const jobId = "history-off-record-497";
    await saveViewState(tabId, {
      view: "summaryView",
      subview: "summarizing",
      url,
      streamId: null,
      jobId,
    });

    await recordPopupSummaryStream(
      {
        model,
        title: "Selection Example",
        url,
        finalize: {
          jobId,
          tabId,
          promptsCacheKey: "suggested-prompts:history-off-key",
          pageType: "selection",
          isSelection: true,
          selectionText: "The confidential paragraph the reader selected.",
          focusKeyword: "the CEO's private notes",
          language: "auto",
          translationEngine: "opus",
        },
      },
      "stream-history-off-497",
    );

    const state = await loadViewState(tabId);
    assert.strictEqual(state.selectionText, undefined);
    assert.strictEqual(state.focusKeyword, undefined);
    assert.strictEqual(
      state.promptsCacheKey,
      "suggested-prompts:history-off-key",
      "the key survives so prompts can still be regenerated",
    );
  } finally {
    await chrome.storage.local.set({ settings });
  }
});

test("recordPopupSummaryStream scrubs on a sensitive host even with history on (#497)", async () => {
  const tabId = 4976;
  const jobId = "sensitive-record-497";
  const sensitiveUrl = "https://mail.google.com/mail/u/0/#inbox/abc";
  await saveViewState(tabId, {
    view: "summaryView",
    subview: "summarizing",
    url: sensitiveUrl,
    streamId: null,
    jobId,
  });

  await recordPopupSummaryStream(
    {
      model,
      title: "Mail",
      url: sensitiveUrl,
      finalize: {
        jobId,
        tabId,
        promptsCacheKey: "suggested-prompts:sensitive-key",
        pageType: "selection",
        isSelection: true,
        selectionText: "The confidential paragraph the reader selected.",
        focusKeyword: "the CEO's private notes",
        language: "auto",
        translationEngine: "opus",
      },
    },
    "stream-sensitive-497",
  );

  const state = await loadViewState(tabId);
  assert.strictEqual(state.selectionText, undefined);
  assert.strictEqual(state.focusKeyword, undefined);
  assert.strictEqual(state.promptsCacheKey, "suggested-prompts:sensitive-key");
});

test("finalizeSummaryJob persists the normal page type and clears selection fields (#497)", async () => {
  const tabId = 4974;
  const jobId = "finalize-normal-after-selection-497";
  await saveViewState(tabId, {
    view: "summaryView",
    subview: "summarizing",
    url,
    streamId: null,
    jobId,
    isSelection: true,
    selectionText: "The old selection must not survive.",
    pageType: "selection",
    focusKeyword: "the old keyword",
  });

  const trusted = await buildTrustedFinalize({
    url,
    title: "Example",
    model,
    content: "Article text.",
    type: "article",
  });
  trusted.jobId = jobId;
  trusted.tabId = tabId;
  trusted.notifyOnFinish = false;

  const result = await finalizeSummaryJob(
    { finalize: trusted, model, title: "Example", url, text: "" },
    { ensureOffscreenDocument: async () => {} },
  );
  assert.strictEqual(result.ok, true);

  const state = await loadViewState(tabId);
  assert.strictEqual(state.subview, "summary");
  assert.strictEqual(state.pageType, "article");
  assert.strictEqual(state.isSelection, false);
  assert.strictEqual(state.selectionText, "");
  assert.strictEqual(state.focusKeyword, "");
});

test("a selection: the UI key equals the trusted finalizer's key (#497)", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const selectionText = "The board approved the merger after a long debate.";
  const trusted = await buildTrustedFinalize({
    url,
    title: "Selection Example",
    model,
    content: selectionText,
    type: "selection",
    focusKeyword,
    finalize: {
      isSelection: true,
      selectionText,
      tabId: 497,
      jobId: "selection-497",
    },
  });

  assert.ok(trusted, "trusted finalize is built");
  assert.strictEqual(trusted.isSelection, true);
  assert.strictEqual(trusted.pageType, "selection");
  assert.strictEqual(trusted.selectionText, selectionText);

  const ui = await getSummaryAndPromptsCacheKeys(
    url,
    settings,
    model,
    focusKeyword,
    { pageType: "selection", selectionText },
  );
  assert.strictEqual(ui.promptsCacheKey, trusted.promptsCacheKey);
});
