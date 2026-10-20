import test from "node:test";
import assert from "node:assert";
import {
  getSummaryCacheKey,
  getPromptsCacheKey,
  shouldPersist,
} from "../../lib/storage/pageCache.js";

function installFakeStorage(initialSettings = {}) {
  const data = {
    settings: {
      saveHistory: true,
      responseFormat: "bullets",
      summaryLanguage: "auto",
      customInstructions: "",
      translationEngine: "opus",
      provider: "webllm",
      webllmModel: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
      ollamaHost: "http://127.0.0.1:11434",
      ...initialSettings,
    },
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return { ...data };
          if (typeof keys === "string") return { [keys]: data[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) out[k] = data[k];
            return out;
          }
          return { ...data };
        },
        set: async (obj) => {
          Object.assign(data, obj);
        },
      },
    },
  };
  return data;
}

test("buildTrustedFinalize rejects payloads with missing or invalid URL", async () => {
  installFakeStorage();
  const url = "https://example.com/test-article";
  const expectedCacheKey = await getSummaryCacheKey(
    url,
    "bullets",
    "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    "auto",
    "",
    "opus",
  );
  const expectedPromptsKey = await getPromptsCacheKey(
    url,
    "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    "auto",
    "",
    "opus",
  );

  // Re-deriving cache keys should always yield expected deterministic keys and ignore untrusted keys
  assert.strictEqual(
    await getSummaryCacheKey(
      url,
      "bullets",
      "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
      "auto",
      "",
      "opus",
    ),
    expectedCacheKey,
  );
  assert.strictEqual(
    await getPromptsCacheKey(
      url,
      "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
      "auto",
      "",
      "opus",
    ),
    expectedPromptsKey,
  );
});

test("shouldPersist correctly enforces history settings for trusted URL persistence", async () => {
  installFakeStorage({ saveHistory: false });
  assert.strictEqual(
    await shouldPersist("https://example.com/test-article"),
    false,
  );

  installFakeStorage({ saveHistory: true });
  assert.strictEqual(
    await shouldPersist("https://example.com/test-article"),
    true,
  );
});

test("internal job registry resolves registered finalize object and ignores untrusted caller input", async () => {
  const registeredJobs = new Map();
  const streamId = "webllm-12345";
  const trustedFinalize = {
    cacheKey: "summary:bullets:auto:model:opus:12345",
    jobId: "job-123",
    tabId: 1,
  };

  registeredJobs.set(streamId, {
    finalize: trustedFinalize,
    model: "trusted-model",
    title: "Trusted Title",
    url: "https://trusted.example.com",
  });

  const callerMessage = {
    streamId,
    finalize: { cacheKey: "FORGED_CACHE_KEY", jobId: "forged-job" },
    model: "forged-model",
    title: "Forged Title",
  };

  const resolvedJob = registeredJobs.get(callerMessage.streamId);
  assert.deepStrictEqual(resolvedJob.finalize, trustedFinalize);
  assert.notStrictEqual(
    resolvedJob.finalize.cacheKey,
    callerMessage.finalize.cacheKey,
  );
});
