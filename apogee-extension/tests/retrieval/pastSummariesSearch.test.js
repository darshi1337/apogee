import test, { beforeEach } from "node:test";
import assert from "node:assert";
import {
  searchPastSummaries,
  clearPastSummariesSearchCache,
} from "../../lib/retrieval/pastSummariesSearch.js";
import { persistSummary } from "../../lib/storage/pageCache.js";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { deferred } from "../helpers/deferred.js";

beforeEach(clearPastSummariesSearchCache);

test("searchPastSummaries returns all entries when query is empty", async () => {
  const cacheOrder = [
    { s: "k1", p: "p1", t: "First Article" },
    { s: "k2", p: "p2", t: "Second Article" },
  ];
  const storedSummaries = {
    k1: "Text one",
    k2: "Text two",
  };

  const results = await searchPastSummaries({
    query: "",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });

  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].s, "k1");
  assert.strictEqual(results[1].s, "k2");
});

test("searchPastSummaries performs keyword matching on title and body when embeddings unavailable", async () => {
  const cacheOrder = [
    { s: "k1", p: "p1", t: "Quantum Computing Breakdown" },
    { s: "k2", p: "p2", t: "Cooking Recipe for Pancakes" },
  ];
  const storedSummaries = {
    k1: "Discusses qubits and superposition principles.",
    k2: "Ingredients include flour, milk, and eggs.",
  };

  const titleMatch = await searchPastSummaries({
    query: "Quantum",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });
  assert.strictEqual(titleMatch.length, 1);
  assert.strictEqual(titleMatch[0].s, "k1");

  const bodyMatch = await searchPastSummaries({
    query: "qubits",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });
  assert.strictEqual(bodyMatch.length, 1);
  assert.strictEqual(bodyMatch[0].s, "k1");

  const noMatch = await searchPastSummaries({
    query: "Astrophysics",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });
  assert.strictEqual(noMatch.length, 0);
});

test("searchPastSummaries uses vector embeddings to rank semantically relevant summaries", async () => {
  const cacheOrder = [
    { s: "k1", p: "p1", t: "Physics Paper", v: [1, 0, 0] },
    { s: "k2", p: "p2", t: "Recipe Book", v: [0, 1, 0] },
  ];
  const storedSummaries = {
    k1: "Details about quantum particles and energy levels.",
    k2: "Baking bread and cakes at high temperatures.",
  };

  const mockEmbed = async (_texts) => {
    // Return query vector close to physics [0.9, 0.1, 0]
    return [[0.9, 0.1, 0]];
  };

  const results = await searchPastSummaries({
    query: "particle physics",
    cacheOrder,
    storedSummaries,
    embedTextsFn: mockEmbed,
  });

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].s, "k1");
});

test("blank queries and empty history never invoke the embedder", async () => {
  let calls = 0;
  const embedTextsFn = () => {
    calls++;
    throw new Error("Embedding should be lazy");
  };
  const cacheOrder = [{ s: "k1", t: "Title" }];
  assert.deepStrictEqual(
    await searchPastSummaries({ query: "  ", cacheOrder, embedTextsFn }),
    cacheOrder,
  );
  assert.deepStrictEqual(
    await searchPastSummaries({ query: "topic", cacheOrder: [], embedTextsFn }),
    [],
  );
  assert.strictEqual(calls, 0);
});

test("a vectorless save is backfilled on search without modifying storage", async (t) => {
  const { chrome, getStorageData } = createExtensionApiMock();
  const originalChrome = globalThis.chrome;
  t.after(() => {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  });
  globalThis.chrome = chrome;
  await persistSummary("k1", "p1", "Particles and energy", "Research");
  const saved = structuredClone(getStorageData());
  assert.strictEqual(saved.cacheOrder[0].v, undefined);
  const calls = [];
  const embedTextsFn = async (texts) => {
    calls.push(texts);
    return texts.map(() => [1, 0]);
  };
  const options = {
    cacheOrder: saved.cacheOrder,
    storedSummaries: saved,
    embedTextsFn,
  };
  const results = await searchPastSummaries({ ...options, query: "physics" });
  assert.deepStrictEqual(
    results.map((entry) => entry.s),
    ["k1"],
  );
  await searchPastSummaries({ ...options, query: "science" });
  assert.deepStrictEqual(calls, [
    ["physics"],
    ["Particles and energy"],
    ["science"],
  ]);
  assert.deepStrictEqual(getStorageData(), saved);
  assert.strictEqual(saved.cacheOrder[0].v, undefined);
});

test("missing vectors are generated in small sequential batches", async () => {
  const cacheOrder = Array.from({ length: 10 }, (_, i) => ({ s: `k${i}` }));
  const storedSummaries = Object.fromEntries(
    cacheOrder.map(({ s }) => [s, `body ${s}`]),
  );
  const calls = [];
  let active = 0;
  const results = await searchPastSummaries({
    query: "query",
    cacheOrder,
    storedSummaries,
    embedTextsFn: async (texts) => {
      assert.strictEqual(active++, 0, "batches must not run concurrently");
      calls.push(texts);
      await Promise.resolve();
      active--;
      return texts.map(() => [1, 0]);
    },
  });
  assert.strictEqual(results.length, 10);
  assert.deepStrictEqual(
    calls.map((batch) => batch.length),
    [1, 4, 4, 2],
  );
});

test("cached vectors track exact body text, removed entries and embedder identity", async () => {
  const cacheOrder = [{ s: "k1" }, { s: "k2" }];
  const storedSummaries = { k1: "first body", k2: "second body" };
  const calls = [];
  const embedTextsFn = async (texts) => {
    calls.push(texts);
    return texts.map(() => [1, 0]);
  };
  const options = { query: "query", cacheOrder, storedSummaries, embedTextsFn };
  await searchPastSummaries(options);
  storedSummaries.k1 = "changed body";
  await searchPastSummaries(options);
  assert.deepStrictEqual(calls, [
    ["query"],
    ["first body", "second body"],
    ["query"],
    ["changed body"],
  ]);
  await searchPastSummaries({ ...options, cacheOrder: [cacheOrder[0]] });
  await searchPastSummaries(options);
  assert.deepStrictEqual(calls.at(-1), ["second body"]);
  calls.length = 0;
  await searchPastSummaries({
    ...options,
    embedTextsFn: async (texts) => {
      calls.push(texts);
      return texts.map(() => [0, 1]);
    },
  });
  assert.deepStrictEqual(calls, [["query"], ["changed body", "second body"]]);
});

test("legacy vectors are reused and missing or blank bodies are not embedded", async () => {
  const cacheOrder = [
    { s: "legacy", v: [1, 0] },
    { s: "missing" },
    { s: "blank" },
  ];
  const calls = [];
  const results = await searchPastSummaries({
    query: "query",
    cacheOrder,
    storedSummaries: { legacy: "stored body", blank: "  " },
    embedTextsFn: async (texts) => {
      calls.push(texts);
      return [[1, 0]];
    },
  });
  assert.deepStrictEqual(calls, [["query"]]);
  assert.deepStrictEqual(
    results.map(({ s }) => s),
    ["legacy"],
  );
});

test("query and backfill failures preserve keyword matches and can retry", async (t) => {
  t.mock.method(console, "warn", () => {});
  const options = {
    query: "keyword",
    cacheOrder: [{ s: "k1" }],
    storedSummaries: { k1: "A keyword body" },
  };
  assert.strictEqual(
    (
      await searchPastSummaries({
        ...options,
        embedTextsFn: async () => {
          throw new Error("Model unavailable");
        },
      })
    ).length,
    1,
  );
  let fail = true;
  let bodyCalls = 0;
  const embedTextsFn = async (texts) => {
    if (texts[0] === "A keyword body") {
      bodyCalls++;
      if (fail) throw new Error("Backfill failed");
    }
    return texts.map(() => [1, 0]);
  };
  assert.strictEqual(
    (await searchPastSummaries({ ...options, embedTextsFn })).length,
    1,
  );
  fail = false;
  await searchPastSummaries({ ...options, embedTextsFn });
  await searchPastSummaries({ ...options, embedTextsFn });
  assert.strictEqual(bodyCalls, 2, "successful retry is cached");
});

test("malformed vectors fall back to keywords and failed backfills retry", async () => {
  const invalid = [[], [NaN, 0], [Infinity, 0], ["1", 0], new Array(2), [1]];
  const cacheOrder = invalid.map((v, i) => ({ s: `k${i}`, v }));
  const storedSummaries = Object.fromEntries(
    cacheOrder.map(({ s }) => [s, `keyword body ${s}`]),
  );
  let bodyCalls = 0;
  const embedTextsFn = async (texts) => {
    if (texts[0] === "keyword") return [[1, 0]];
    bodyCalls++;
    return texts.map(() => [NaN, 0]);
  };
  for (let i = 0; i < 2; i++) {
    const results = await searchPastSummaries({
      query: "keyword",
      cacheOrder,
      storedSummaries,
      embedTextsFn,
    });
    assert.deepStrictEqual(results, cacheOrder);
  }
  assert.strictEqual(bodyCalls, 4);
  for (const vector of invalid.filter((v) => v.length !== 1)) {
    const results = await searchPastSummaries({
      query: "keyword",
      cacheOrder,
      storedSummaries,
      embedTextsFn: async () => [vector],
    });
    assert.deepStrictEqual(results, cacheOrder);
  }
});

test("overlapping searches share pending summary embeddings", async () => {
  const started = deferred();
  const release = deferred();
  let bodyCalls = 0;
  const options = {
    cacheOrder: [{ s: "k1" }],
    storedSummaries: { k1: "summary body" },
    embedTextsFn: async (texts) => {
      if (texts[0] === "summary body") {
        bodyCalls++;
        started.resolve();
        await release.promise;
      }
      return texts.map(() => [1, 0]);
    },
  };
  const first = searchPastSummaries({ ...options, query: "first" });
  await started.promise;
  const second = searchPastSummaries({ ...options, query: "second" });
  await new Promise(setImmediate);
  release.resolve();
  const results = await Promise.all([first, second]);
  assert.strictEqual(bodyCalls, 1);
  assert.deepStrictEqual(
    results.map((entries) => entries[0].s),
    ["k1", "k1"],
  );
});

test("resetting during backfill prevents late results and rebuilds on next search", async () => {
  const started = deferred();
  const release = deferred();
  let bodyCalls = 0;
  const options = {
    query: "query",
    cacheOrder: [{ s: "k1" }],
    storedSummaries: { k1: "summary body" },
    embedTextsFn: async (texts) => {
      if (texts[0] === "summary body") {
        bodyCalls++;
        started.resolve();
        await release.promise;
      }
      return texts.map(() => [1, 0]);
    },
  };
  const pending = searchPastSummaries(options);
  await started.promise;
  clearPastSummariesSearchCache();
  release.resolve();
  assert.deepStrictEqual(await pending, []);
  assert.strictEqual((await searchPastSummaries(options)).length, 1);
  assert.strictEqual(bodyCalls, 2);
});

test("resetting while the query loads does not start a stale backfill", async () => {
  const started = deferred();
  const release = deferred();
  const calls = [];
  const pending = searchPastSummaries({
    query: "query",
    cacheOrder: [{ s: "k1" }],
    storedSummaries: { k1: "body" },
    embedTextsFn: async (texts) => {
      calls.push(texts);
      started.resolve();
      await release.promise;
      return texts.map(() => [1, 0]);
    },
  });
  await started.promise;
  clearPastSummariesSearchCache();
  release.resolve();
  assert.deepStrictEqual(await pending, []);
  assert.deepStrictEqual(calls, [["query"]]);
});

test("aborting a search stops subsequent backfill batches", async () => {
  const controller = new AbortController();
  const cacheOrder = Array.from({ length: 9 }, (_, i) => ({ s: `k${i}` }));
  const calls = [];
  const results = await searchPastSummaries({
    query: "query",
    cacheOrder,
    storedSummaries: Object.fromEntries(
      cacheOrder.map(({ s }) => [s, `body ${s}`]),
    ),
    signal: controller.signal,
    embedTextsFn: async (texts) => {
      calls.push(texts);
      if (texts[0] !== "query") controller.abort();
      return texts.map(() => [1, 0]);
    },
  });
  assert.deepStrictEqual(results, []);
  assert.deepStrictEqual(
    calls.map((batch) => batch.length),
    [1, 4],
  );
});
