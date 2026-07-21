import test from "node:test";
import assert from "node:assert";

import {
  hashUrl,
  getSummaryCacheKey,
  getPromptsCacheKey,
  getContentCacheKey,
  persistSummary,
  isSensitiveUrl,
  shouldPersist,
  MAX_CACHED_PAGES,
} from "../lib/pageCache.js";

// Same in-memory chrome.storage.local fake convention tests/attachToStream.test.js
// establishes for chrome.runtime, backed by a plain object instead of ports.
function installFakeStorage(initial = {}) {
  const data = { ...initial };
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
        remove: async (keys) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        },
      },
    },
  };
  return data;
}

test("hashUrl is deterministic and distinguishes different URLs", () => {
  assert.strictEqual(
    hashUrl("https://example.com/a"),
    hashUrl("https://example.com/a"),
  );
  assert.notStrictEqual(
    hashUrl("https://example.com/a"),
    hashUrl("https://example.com/b"),
  );
});

test("cache key helpers embed the hashed url and are namespaced by kind", () => {
  const url = "https://example.com/article";
  const hash = hashUrl(url);
  assert.strictEqual(
    getSummaryCacheKey(url, "bullets", "model-x"),
    `summary:bullets:model-x:${hash}`,
  );
  assert.strictEqual(
    getPromptsCacheKey(url, "bullets", "model-x"),
    `suggested-prompts:bullets:model-x:${hash}`,
  );
  assert.strictEqual(getContentCacheKey(url), `content:${hash}`);
});

test("isSensitiveUrl matches known webmail/messaging hosts and their subdomains", () => {
  assert.ok(isSensitiveUrl("https://mail.google.com/mail/u/0/"));
  assert.ok(isSensitiveUrl("https://web.whatsapp.com/"));
  assert.ok(isSensitiveUrl("https://foo.teams.live.com/"));
  assert.ok(!isSensitiveUrl("https://example.com/"));
  assert.ok(!isSensitiveUrl("not a url at all"));
});

test("shouldPersist respects saveHistory for a non-sensitive host", async () => {
  installFakeStorage({ settings: { saveHistory: false } });
  assert.strictEqual(await shouldPersist("https://example.com/"), false);

  installFakeStorage({ settings: { saveHistory: true } });
  assert.strictEqual(await shouldPersist("https://example.com/"), true);
});

test("shouldPersist is always false for a sensitive host, regardless of saveHistory", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  assert.strictEqual(await shouldPersist("https://mail.google.com/"), false);
});

test("persistSummary evicts the oldest entry once the FIFO cap is exceeded", async () => {
  const data = installFakeStorage();

  for (let i = 0; i < MAX_CACHED_PAGES + 1; i++) {
    await persistSummary(
      `summary-key-${i}`,
      `prompts-key-${i}`,
      `text ${i}`,
      `Title ${i}`,
    );
  }

  assert.strictEqual(data.cacheOrder.length, MAX_CACHED_PAGES);
  // The very first entry (index 0) should have been evicted, both from the
  // order index and its own stored keys.
  assert.ok(!data.cacheOrder.some((e) => e.s === "summary-key-0"));
  assert.strictEqual(data["summary-key-0"], undefined);
  assert.strictEqual(data["prompts-key-0"], undefined);
  // The most recent entry should still be present.
  assert.strictEqual(
    data[`summary-key-${MAX_CACHED_PAGES}`],
    `text ${MAX_CACHED_PAGES}`,
  );
});

test("persistSummary re-persisting the same cacheKey doesn't duplicate its order entry", async () => {
  const data = installFakeStorage();

  await persistSummary("k1", "p1", "first", "Title");
  await persistSummary("k1", "p1", "updated", "Title");

  assert.strictEqual(data.cacheOrder.length, 1);
  assert.strictEqual(data.k1, "updated");
});
