import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { runSuggestQuestionsJob } from "../../background/suggestQuestions.js";
import { getRemoteSettings } from "../../lib/storage/remoteSettings.js";
import { persistSuggestedQuestionsIfAllowed } from "../../lib/storage/pageCache.js";

const { chrome, getStorageData } = createExtensionApiMock();
globalThis.chrome = chrome;
chrome.alarms = { create() {} };
const broadcasts = [];
chrome.runtime.sendMessage = async (message) => broadcasts.push(message);
const response = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"What happened?\\nWhy does it matter?"}}]}\n\ndata: [DONE]\n\n',
  );
let calls;
async function setup(provider = "openrouter", overrides = {}) {
  broadcasts.length = 0;
  calls = [];
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    settings: {
      provider,
      autoEngine: false,
      [`${provider}Consent`]: true,
      [`${provider}GenerationConsent`]: true,
      [`${provider}SuggestionsConsent`]: true,
      [`${provider}GenerationRevision`]: 3,
      [`${provider}ApiKey`]: "secret",
      [`${provider}Model`]: "test/model",
      summaryLanguage: "auto",
      translationEngine: "llm",
      saveHistory: true,
      ...overrides,
    },
    [`remoteCatalog:${provider}`]: {
      models: [{ id: "test/model", label: "Test", contextTokens: 8192 }],
      refreshedAt: Date.now(),
      failed: false,
    },
  });
  await getRemoteSettings();
  await chrome.storage.local.set({
    [`remoteCatalog:${provider}`]: {
      models: [{ id: "test/model", label: "Test", contextTokens: 8192 }],
      refreshedAt: Date.now(),
      failed: false,
    },
  });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return response();
  };
  return {
    promptsCacheKey: `suggested-prompts:${provider}`,
    providerType: provider,
    execution: { provider, model: "test/model", revision: 3 },
    title: "Page",
    url: "https://example.com/page",
    summary: "The event took place yesterday.",
  };
}

test("separate suggestion admission generates through both providers and caches only parsed questions", async () => {
  for (const provider of ["openrouter", "opencode"]) {
    const payload = await setup(provider);
    await runSuggestQuestionsJob(payload);
    assert.equal(calls.length, 1);
    assert.deepEqual(getStorageData()[payload.promptsCacheKey], [
      "What happened?",
      "Why does it matter?",
    ]);
    assert.equal(
      broadcasts.filter((m) => m.type === "suggested-prompts-ready").length,
      1,
    );
  }
});

test("missing separate consent or changed parent revision cannot transmit summary text", async () => {
  for (const overrides of [
    { openrouterSuggestionsConsent: false },
    { openrouterGenerationRevision: 4 },
  ]) {
    const payload = await setup("openrouter", overrides);
    await runSuggestQuestionsJob(payload);
    assert.equal(calls.length, 0);
    assert.equal(broadcasts.length, 0);
    assert.equal(getStorageData()[payload.promptsCacheKey], undefined);
  }
});

test("authorization changes during suggestions discard questions and successful broadcasts", async () => {
  for (const provider of ["openrouter", "opencode"]) {
    for (const suffix of ["SuggestionsConsent", "ApiKey", "Model"]) {
      const changes = {
        [`${provider}${suffix}`]:
          suffix === "SuggestionsConsent" ? false : "replacement",
      };
      const payload = await setup(provider);
      globalThis.fetch = async () => {
        await chrome.storage.local.set({
          settings: { ...getStorageData().settings, ...changes },
        });
        return response();
      };
      await runSuggestQuestionsJob(payload);
      assert.equal(getStorageData()[payload.promptsCacheKey], undefined);
      assert.equal(broadcasts.length, 0);
    }
  }
});

test("legacy changes are also discarded", async () => {
  for (const changes of [
    { openrouterSuggestionsConsent: false },
    { openrouterApiKey: "replacement" },
    { openrouterModel: "other/model" },
  ]) {
    const payload = await setup();
    globalThis.fetch = async () => {
      await chrome.storage.local.set({
        settings: { ...getStorageData().settings, ...changes },
      });
      return response();
    };
    await runSuggestQuestionsJob(payload);
    assert.equal(getStorageData()[payload.promptsCacheKey], undefined);
    assert.equal(broadcasts.length, 0);
  }
});

test("private contributor and history changes prevent suggestion persistence", async () => {
  const payload = await setup("openrouter", {
    privateHosts: "private.example",
  });
  await runSuggestQuestionsJob({
    ...payload,
    sourceUrls: [payload.url, "https://private.example/mail"],
  });
  assert.equal(getStorageData()[payload.promptsCacheKey], undefined);
  assert.equal(broadcasts.length, 1);
});

test("question commit rolls back a previously stored value after authorization changes during write", async () => {
  await setup();
  await chrome.storage.local.set({ questions: ["Previous?"] });
  let checks = 0;
  await assert.rejects(
    persistSuggestedQuestionsIfAllowed(
      "questions",
      ["New?"],
      ["https://example.com"],
      {
        assertAuthorized: async () => {
          if (++checks === 2) throw new Error("revoked");
        },
      },
    ),
    /revoked/,
  );
  assert.deepEqual(getStorageData().questions, ["Previous?"]);
});

test("permission removal stops each provider before persistence or broadcast", async () => {
  const target = process.env.TARGET_BROWSER;
  process.env.TARGET_BROWSER = "firefox";
  const original = chrome.permissions.contains;
  try {
    for (const provider of ["openrouter", "opencode"]) {
      chrome.permissions.contains = async () => true;
      const payload = await setup(provider);
      globalThis.fetch = async () => {
        chrome.permissions.contains = async () => false;
        return response();
      };
      await runSuggestQuestionsJob(payload);
      assert.equal(getStorageData()[payload.promptsCacheKey], undefined);
      assert.equal(broadcasts.length, 0);
    }
  } finally {
    chrome.permissions.contains = original;
    if (target === undefined) delete process.env.TARGET_BROWSER;
    else process.env.TARGET_BROWSER = target;
  }
});

test("concurrent callers share one suggestion generation", async () => {
  const payload = await setup();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async () => {
    calls.push({});
    started();
    await held;
    return response();
  };
  const first = runSuggestQuestionsJob(payload);
  await ready;
  await runSuggestQuestionsJob(payload);
  release();
  await first;
  assert.equal(calls.length, 1);
  assert.equal(broadcasts.length, 1);
});
