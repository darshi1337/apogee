import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

// --- #392: suggest-questions-bg rebuilt promptsCacheKey without focusKeyword ---
//
// The popup computes a keyword-scoped promptsCacheKey and passes it in the
// payload, but the service-worker handler rebuilt the key from the URL
// without the focusKeyword and overwrote it. Suggestions for different
// keywords then collided on one cache entry. The rebuilt key must include
// the payload's focusKeyword.

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

const { runBackgroundSummarize } =
  await import("../../background/service-worker.js");
const { getPromptsCacheKey } = await import("../../lib/storage/pageCache.js");
const { loadViewState } = await import("../../lib/storage/viewState.js");
const { getProviderType } = await import("../../lib/engines/providers.js");
const { getModelForSettings } = await import("../../lib/engines/providers.js");

test("suggest-questions-bg scopes the rebuilt promptsCacheKey by focusKeyword (#392)", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const model = getModelForSettings(settings);
  const url = "https://example.com/article-392";
  const focusKeyword = "battery pricing";

  const expectedKey = await getPromptsCacheKey(
    url,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
    focusKeyword,
    {
      providerType: getProviderType(settings),
      pageType: "",
      selectionText: "",
    },
  );
  const unscopedKey = await getPromptsCacheKey(
    url,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
  );
  assert.notStrictEqual(
    expectedKey,
    unscopedKey,
    "test premise: keyword changes the cache key",
  );

  await chrome.runtime.sendMessage({
    target: "service-worker",
    action: "suggest-questions-bg",
    payload: {
      url,
      title: "Example",
      summary: "A summary.",
      model,
      language: settings.summaryLanguage,
      translationEngine: settings.translationEngine,
      focusKeyword,
    },
  });

  const deadline = Date.now() + 2000;
  let stored;
  while (Date.now() < deadline) {
    stored = await chrome.storage.local.get(expectedKey);
    if (stored[expectedKey] !== undefined) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.notStrictEqual(
    stored?.[expectedKey],
    undefined,
    "keyword-scoped promptsCacheKey was written",
  );
});

// --- #497: a selection's generation key must survive the background rebuild ---
//
// Selection summaries start in the background, then restore asks the
// suggest-questions handler for questions again. Generation used to scope the
// key with a fake "#apogee-selection" URL while the handler rebuilt it from the
// plain URL, so the reply landed under a key the UI never listened on.

// Generation registers the stream before the model starts, so it only needs a
// provider whose start path does not require Chrome's offscreen document.
async function useLocalProvider() {
  const { settings } = await chrome.storage.local.get("settings");
  const local = {
    ...settings,
    provider: "local",
    localModel: "test-local-model",
    ollamaHost: "http://127.0.0.1:11434",
  };
  await chrome.storage.local.set({ settings: local });
  return { original: settings, local };
}

async function startBackgroundSelection(tabId, url, selectionText) {
  await runBackgroundSummarize(
    { id: tabId, url, title: "Selection Example", windowId: 1 },
    { notifyOnFinish: false, selectionText },
  );
  return loadViewState(tabId);
}

async function announcedPromptsKey(payload) {
  const announced = [];
  const listener = (message) => {
    if (message?.type === "suggested-prompts-ready") {
      announced.push(message.promptsCacheKey);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  try {
    await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "suggest-questions-bg",
      payload: { ...payload, persist: false },
    });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (announced.length > 0) return announced[0];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return null;
  } finally {
    chrome.runtime.onMessage.removeListener(listener);
  }
}

test("selection generation and the handler rebuild the same promptsCacheKey (#497)", async () => {
  const { original, local } = await useLocalProvider();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("no local model in tests");
  };
  try {
    const url = "https://example.com/selection-generation-497";
    const selectionText =
      "The selected paragraph explains the trade-offs in detail.";

    const state = await startBackgroundSelection(4971, url, selectionText);
    assert.ok(state?.promptsCacheKey, "generation stored a promptsCacheKey");
    assert.strictEqual(state.pageType, "selection");
    assert.strictEqual(state.selectionText, selectionText);

    const rebuiltKey = await announcedPromptsKey({
      url,
      title: "Selection Example",
      summary: "A summary.",
      model: getModelForSettings(local),
      language: local.summaryLanguage,
      translationEngine: local.translationEngine,
      pageType: state.pageType,
      selectionText: state.selectionText,
    });

    assert.ok(rebuiltKey, "the handler announced a promptsCacheKey");
    assert.strictEqual(rebuiltKey, state.promptsCacheKey);
  } finally {
    globalThis.fetch = originalFetch;
    await chrome.storage.local.set({ settings: original });
  }
});

// --- #497: a supplied key is authoritative ---
//
// Callers can compute a key the worker cannot reconstruct (custom content,
// legacy restores, multi-tab rebuilds). Recomputing from the URL overwrote it
// and the questions landed under a key the popup was not listening on.

test("suggest-questions-bg honors a supplied promptsCacheKey (#497)", async () => {
  const { original, local } = await useLocalProvider();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("no local model in tests");
  };
  try {
    const url = "https://example.com/supplied-key-497";
    const suppliedKey = "suggested-prompts:caller-owned:key";
    const announcedKey = await announcedPromptsKey({
      url,
      promptsCacheKey: suppliedKey,
      title: "Supplied Key",
      summary: "A summary.",
      model: getModelForSettings(local),
      language: local.summaryLanguage,
      translationEngine: local.translationEngine,
      pageType: "article",
      selectionText: "",
    });

    assert.strictEqual(
      announcedKey,
      suppliedKey,
      "the handler must not replace the caller's key",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await chrome.storage.local.set({ settings: original });
  }
});

test("two selections on one URL cannot share suggested questions (#497)", async () => {
  const { original, local } = await useLocalProvider();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("no local model in tests");
  };
  try {
    const url = "https://example.com/selection-isolation-497";
    const firstText = "The first selected paragraph is about pricing.";
    const secondText = "A different selected paragraph is about safety.";

    const firstState = await startBackgroundSelection(4972, url, firstText);
    const secondState = await startBackgroundSelection(4973, url, secondText);
    assert.notStrictEqual(
      firstState.promptsCacheKey,
      secondState.promptsCacheKey,
      "different selected text must scope different keys",
    );

    const handlerPayload = (state) => ({
      url,
      title: "Selection Example",
      summary: "A summary.",
      model: getModelForSettings(local),
      language: local.summaryLanguage,
      translationEngine: local.translationEngine,
      pageType: state.pageType,
      selectionText: state.selectionText,
    });

    const firstKey = await announcedPromptsKey(handlerPayload(firstState));
    const secondKey = await announcedPromptsKey(handlerPayload(secondState));

    assert.strictEqual(firstKey, firstState.promptsCacheKey);
    assert.strictEqual(secondKey, secondState.promptsCacheKey);
    assert.notStrictEqual(firstKey, secondKey);
  } finally {
    globalThis.fetch = originalFetch;
    await chrome.storage.local.set({ settings: original });
  }
});
