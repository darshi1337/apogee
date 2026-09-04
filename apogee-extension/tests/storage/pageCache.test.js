import test from "node:test";
import assert from "node:assert";

import {
  hashUrl,
  getSummaryCacheKey,
  getPromptsCacheKey,
  getContentCacheKey,
  parseSummaryCacheKey,
  persistSummary,
  persistSummaryIfAllowed,
  persistContent,
  clearCachedPages,
  isSensitiveUrl,
  isSensitiveTitle,
  sanitizeTitleForStorage,
  isPrivateUrl,
  parsePrivateHosts,
  matchesPrivateHost,
  shouldPersist,
  MAX_CACHED_PAGES,
} from "../../lib/storage/pageCache.js";

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

test("hashUrl is deterministic and distinguishes different URLs", async () => {
  assert.strictEqual(
    await hashUrl("https://example.com/a"),
    await hashUrl("https://example.com/a"),
  );
  assert.notStrictEqual(
    await hashUrl("https://example.com/a"),
    await hashUrl("https://example.com/b"),
  );
});

test("hashUrl keeps no readable trace of the url it came from", async () => {
  const hash = await hashUrl("https://example.com/reset?token=hunter2");
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.ok(!hash.includes("hunter2"));
  assert.ok(!hash.includes("example"));
});

test("cache key helpers embed the hashed url and are namespaced by kind", async () => {
  const url = "https://example.com/article";
  const hash = await hashUrl(url);
  assert.strictEqual(
    await getSummaryCacheKey(url, "bullets", "model-x"),
    `summary:bullets:auto:model-x:opus:${hash}`,
  );
  assert.strictEqual(
    await getSummaryCacheKey(url, "bullets", "model-x", "es"),
    `summary:bullets:es:model-x:opus:${hash}`,
  );
  assert.strictEqual(
    await getPromptsCacheKey(url, "bullets", "model-x"),
    `suggested-prompts:bullets:auto:model-x:opus:${hash}`,
  );
  assert.strictEqual(
    await getPromptsCacheKey(url, "bullets", "model-x", "es"),
    `suggested-prompts:bullets:es:model-x:opus:${hash}`,
  );
  assert.strictEqual(await getContentCacheKey(url), `content:${hash}`);
});

test("parseSummaryCacheKey recovers format, language, and model", async () => {
  const url = "https://example.com/article";
  assert.deepStrictEqual(
    parseSummaryCacheKey(await getSummaryCacheKey(url, "bullets", "model-x")),
    { format: "bullets", language: "auto", model: "model-x" },
  );
  assert.deepStrictEqual(
    parseSummaryCacheKey(
      await getSummaryCacheKey(url, "bullets", "model-x", "es"),
    ),
    { format: "bullets", language: "es", model: "model-x" },
  );
});

test("parseSummaryCacheKey tolerates colons in the model and an instructions suffix", async () => {
  const url = "https://example.com/article";
  assert.deepStrictEqual(
    parseSummaryCacheKey(await getSummaryCacheKey(url, "bullets", "qwen3:8b")),
    { format: "bullets", language: "auto", model: "qwen3:8b" },
  );
  assert.deepStrictEqual(
    parseSummaryCacheKey(
      await getSummaryCacheKey(
        url,
        "bullets",
        "model-x",
        "auto",
        "Focus on the numbers",
      ),
    ),
    { format: "bullets", language: "auto", model: "model-x" },
  );
});

test("parseSummaryCacheKey falls back to empty strings for foreign keys", () => {
  const fallback = { format: "", language: "", model: "" };
  assert.deepStrictEqual(parseSummaryCacheKey("content:abc123"), fallback);
  assert.deepStrictEqual(parseSummaryCacheKey("summary:onlyone"), fallback);
  assert.deepStrictEqual(parseSummaryCacheKey(null), fallback);
  assert.deepStrictEqual(parseSummaryCacheKey(""), fallback);
});

test("cache keys change with the translation engine that shaped the output", async () => {
  const args = ["https://example.com/article", "bullets", "model-x", "bg", ""];

  const llmSummary = await getSummaryCacheKey(...args, "llm");
  const opusSummary = await getSummaryCacheKey(...args, "opus");
  const llmPrompts = await getPromptsCacheKey(...args, "llm");
  const opusPrompts = await getPromptsCacheKey(...args, "opus");

  assert.notStrictEqual(llmSummary, opusSummary);
  assert.notStrictEqual(llmPrompts, opusPrompts);
  assert.match(llmSummary, /:llm:/);
  assert.match(opusSummary, /:opus:/);
});

test("cache keys change with the custom instructions that shaped the prompt", async () => {
  const url = "https://example.com/article";
  const base = await getSummaryCacheKey(url, "bullets", "model-x", "auto");
  const withInstructions = await getSummaryCacheKey(
    url,
    "bullets",
    "model-x",
    "auto",
    "Focus on the numbers",
  );
  const withOtherInstructions = await getSummaryCacheKey(
    url,
    "bullets",
    "model-x",
    "auto",
    "Focus on the argument",
  );

  assert.notStrictEqual(base, withInstructions);
  assert.notStrictEqual(withInstructions, withOtherInstructions);
  assert.strictEqual(
    withInstructions,
    await getSummaryCacheKey(
      url,
      "bullets",
      "model-x",
      "auto",
      "Focus on the numbers",
    ),
  );

  assert.notStrictEqual(
    await getPromptsCacheKey(
      url,
      "bullets",
      "model-x",
      "auto",
      "Focus on the numbers",
    ),
    await getPromptsCacheKey(url, "bullets", "model-x", "auto"),
  );
});

test("empty or whitespace-only instructions omit the instructions suffix", async () => {
  const url = "https://example.com/article";
  const hash = await hashUrl(url);

  for (const instructions of [undefined, "", "   \n  "]) {
    assert.strictEqual(
      await getSummaryCacheKey(url, "bullets", "model-x", "auto", instructions),
      `summary:bullets:auto:model-x:opus:${hash}`,
    );
    assert.strictEqual(
      await getPromptsCacheKey(url, "bullets", "model-x", "auto", instructions),
      `suggested-prompts:bullets:auto:model-x:opus:${hash}`,
    );
  }
});

test("cache keys keep no readable trace of the instructions they came from", async () => {
  const key = await getSummaryCacheKey(
    "https://example.com/article",
    "bullets",
    "model-x",
    "auto",
    "always mention hunter2",
  );
  assert.ok(!key.includes("hunter2"));
  assert.match(key, /:i[0-9a-f]{12}$/);
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

test("URL-less summaries can be persisted without throwing", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });

  assert.strictEqual(await shouldPersist(""), true);
  assert.strictEqual(
    await persistSummaryIfAllowed(
      "",
      "summary:local-paste",
      "suggested-prompts:local-paste",
      "A pasted summary.",
      "Pasted Text",
      null,
      { embedTextsFn: null },
    ),
    true,
  );
  assert.strictEqual(data["summary:local-paste"], "A pasted summary.");
});

test("shouldPersist is always false for a sensitive host, regardless of saveHistory", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  assert.strictEqual(await shouldPersist("https://mail.google.com/"), false);
});

test("parsePrivateHosts accepts the shapes people actually paste", () => {
  assert.deepStrictEqual(
    parsePrivateHosts("mail.example.com\nportal.myclinic.org"),
    ["mail.example.com", "portal.myclinic.org"],
  );
  assert.deepStrictEqual(parsePrivateHosts("https://mail.example.com/inbox"), [
    "mail.example.com",
  ]);
  assert.deepStrictEqual(parsePrivateHosts("*.example.com, www.example.org"), [
    "example.com",
    "example.org",
  ]);
  assert.deepStrictEqual(parsePrivateHosts("  \n  "), []);
  assert.deepStrictEqual(parsePrivateHosts(undefined), []);
  // A bare word is a typo, not a host, and must not match everything.
  assert.deepStrictEqual(parsePrivateHosts("localhost\nexample"), []);
});

test("matchesPrivateHost covers subdomains but not lookalike hosts", () => {
  const list = "example.com";
  assert.ok(matchesPrivateHost("https://example.com/page", list));
  assert.ok(matchesPrivateHost("https://mail.example.com/page", list));
  assert.ok(!matchesPrivateHost("https://notexample.com/page", list));
  assert.ok(!matchesPrivateHost("https://example.com.evil.test/", list));
  assert.ok(!matchesPrivateHost("not a url", list));
  assert.ok(!matchesPrivateHost("https://example.com/", ""));
});

test("shouldPersist is false for a host the user marked private", async () => {
  installFakeStorage({
    settings: { saveHistory: true, privateHosts: "myclinic.org" },
  });
  assert.strictEqual(
    await shouldPersist("https://portal.myclinic.org/results"),
    false,
  );
  assert.strictEqual(await shouldPersist("https://example.com/"), true);
});

test("isPrivateUrl covers both lists and takes settings when given", async () => {
  installFakeStorage({ settings: { privateHosts: "myclinic.org" } });
  assert.strictEqual(await isPrivateUrl("https://mail.google.com/"), true);
  assert.strictEqual(await isPrivateUrl("https://portal.myclinic.org/"), true);
  assert.strictEqual(await isPrivateUrl("https://example.com/"), false);

  // Passing settings avoids a second storage read, and must behave the same.
  assert.strictEqual(
    await isPrivateUrl("https://portal.myclinic.org/", {
      privateHosts: "myclinic.org",
    }),
    true,
  );
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
  assert.ok(!data.cacheOrder.some((e) => e.s === "summary-key-0"));
  assert.strictEqual(data["summary-key-0"], undefined);
  assert.strictEqual(data["prompts-key-0"], undefined);
  assert.strictEqual(
    data[`summary-key-${MAX_CACHED_PAGES}`],
    `text ${MAX_CACHED_PAGES}`,
  );
});

test("persistSummary re-persisting the same cacheKey doesn't duplicate its order entry", async () => {
  const data = installFakeStorage();

  await persistSummary("k1", "p1", "first", "Title", null, {
    embedTextsFn: null,
  });
  await persistSummary("k1", "p1", "updated", "Title", null, {
    embedTextsFn: null,
  });

  assert.strictEqual(data.cacheOrder.length, 1);
  assert.strictEqual(data.k1, "updated");
});

test("persistSummary stores vector embedding if provided or generated", async () => {
  const data = installFakeStorage();
  const fakeEmbed = async (_texts) => [[0.1, 0.2, 0.3]];

  await persistSummary("k1", "p1", "summary text", "Title 1", [0.5, 0.6]);
  assert.deepStrictEqual(data.cacheOrder[0].v, [0.5, 0.6]);

  await persistSummary("k2", "p2", "summary text 2", "Title 2", null, {
    embedTextsFn: fakeEmbed,
  });
  assert.deepStrictEqual(data.cacheOrder[1].v, [0.1, 0.2, 0.3]);
});

test("clearCachedPages removes stored history and leaves settings alone", async () => {
  const settings = { saveHistory: true, responseFormat: "bullets" };
  const data = installFakeStorage({ settings });

  await persistSummary(
    "summary:bullets:auto:m:abc",
    "suggested-prompts:bullets:auto:m:abc",
    "The board approved the merger.",
    "Board notes",
  );
  await chrome.storage.local.set({
    "suggested-prompts:bullets:auto:m:abc": ["What did they decide?"],
  });
  await persistContent("https://example.com/article", {
    title: "Board notes",
    content: "The board met on Tuesday.",
    type: "article",
  });

  const removed = await clearCachedPages();

  assert.ok(removed > 0);
  assert.deepStrictEqual(
    Object.keys(data).filter(
      (k) =>
        k.startsWith("summary:") ||
        k.startsWith("suggested-prompts:") ||
        k.startsWith("content:"),
    ),
    [],
  );
  assert.strictEqual(data.cacheOrder, undefined);
  assert.strictEqual(data.contentCacheOrder, undefined);
  assert.deepStrictEqual(data.settings, settings);
});

test("clearCachedPages on an empty store removes nothing", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });

  assert.strictEqual(await clearCachedPages(), 0);
  assert.deepStrictEqual(Object.keys(data), ["settings"]);
});

test("persistSummaryIfAllowed writes while history is still on", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });

  const saved = await persistSummaryIfAllowed(
    "https://example.com/article",
    "summary:k",
    "suggested-prompts:k",
    "Body",
    "Title",
  );

  assert.strictEqual(saved, true);
  assert.strictEqual(data["summary:k"], "Body");
});

test("persistSummaryIfAllowed drops the write when history goes off mid-job", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });
  const url = "https://example.com/article";

  // What the job captured when it started, a minute of generation ago.
  assert.strictEqual(await shouldPersist(url), true);
  // The user opens settings and turns history off while it is still running.
  data.settings = { saveHistory: false };

  const saved = await persistSummaryIfAllowed(
    url,
    "summary:k",
    "suggested-prompts:k",
    "Body",
    "Title",
  );

  assert.strictEqual(saved, false);
  assert.strictEqual(data["summary:k"], undefined);
  assert.strictEqual(data.cacheOrder, undefined);
});

test("persistSummaryIfAllowed drops the write when the host is marked private mid-job", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });
  const url = "https://portal.myclinic.org/results";

  assert.strictEqual(await shouldPersist(url), true);
  data.settings = { saveHistory: true, privateHosts: "myclinic.org" };

  assert.strictEqual(
    await persistSummaryIfAllowed(
      url,
      "summary:k",
      "suggested-prompts:k",
      "Body",
      "Title",
    ),
    false,
  );
  assert.strictEqual(data["summary:k"], undefined);
});

test("isSensitiveTitle detects sensitive page title patterns and excludes them from storage index", async () => {
  assert.strictEqual(isSensitiveTitle("Gmail - Inbox (3)"), true);
  assert.strictEqual(isSensitiveTitle("Bank Account Statement Summary"), true);
  assert.strictEqual(
    isSensitiveTitle("Patient Portal - Medical Records"),
    true,
  );
  assert.strictEqual(
    isSensitiveTitle("Understanding Quantum Computing"),
    false,
  );

  assert.strictEqual(await sanitizeTitleForStorage("Gmail - Inbox (3)"), "");
  assert.strictEqual(
    await sanitizeTitleForStorage("Understanding Quantum Computing"),
    "Understanding Quantum Computing",
  );

  const data = installFakeStorage({ settings: { saveHistory: true } });
  await persistSummary("k1", "p1", "summary body", "Gmail - Inbox", null, {});
  assert.strictEqual(data.cacheOrder[0].t, "");

  await persistSummary(
    "k2",
    "p2",
    "summary body 2",
    "Public Research Article",
    null,
    {},
  );
  assert.strictEqual(data.cacheOrder[1].t, "Public Research Article");
});
