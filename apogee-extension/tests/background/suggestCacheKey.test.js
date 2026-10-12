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

await import("../../background/service-worker.js");
const { getPromptsCacheKey } = await import("../../lib/storage/pageCache.js");
const { getModelForSettings } = await import("../../lib/engines/providers.js");

test("suggest-questions-bg scopes the rebuilt promptsCacheKey by focusKeyword (#392)", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  const model = getModelForSettings(settings);
  const url = "https://example.com/article-392";
  const focusKeyword = "battery pricing";

  const expectedKey = await getPromptsCacheKey(
    url,
    settings.responseFormat,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
    focusKeyword,
  );
  const unscopedKey = await getPromptsCacheKey(
    url,
    settings.responseFormat,
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
