import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { searchPastSummaries } from "../../lib/retrieval/pastSummariesSearch.js";
import { createPastSummariesController } from "../../ui/pastSummaries.js";
import { deferred } from "../helpers/deferred.js";

const appSource = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

function fixture(overrides = {}) {
  const cacheOrder = Array.from({ length: 12 }, (_, i) => ({
    s: `k${i}`,
    t: `Article ${i}`,
  }));
  const stored = Object.fromEntries(
    cacheOrder.map((entry) => [entry.s, `Body for ${entry.s}`]),
  );
  stored.k0 = "UNIQUEWORD in an older summary";
  const renders = [];
  const calls = [];
  const scheduled = new Map();
  let resets = 0;
  let nextTimer = 0;
  const controller = createPastSummariesController({
    readIndex: async () => cacheOrder,
    readTexts: async () => stored,
    search: async (options) => {
      calls.push(options);
      return searchPastSummaries({ ...options, embedTextsFn: null });
    },
    renderResults: (entries) => renders.push({ type: "search", entries }),
    renderRecent: (entries) => renders.push({ type: "recent", entries }),
    clearSearchCache: () => resets++,
    onError: (err) => {
      throw err;
    },
    schedule: (callback, delay) => {
      assert.strictEqual(delay, 150);
      scheduled.set(++nextTimer, callback);
      return nextTimer;
    },
    cancel: (id) => scheduled.delete(id),
    ...overrides,
  });
  return {
    controller,
    cacheOrder,
    stored,
    renders,
    calls,
    scheduled,
    resets: () => resets,
  };
}

test("popup searches the full index and renders keywords before semantics", async () => {
  const semantic = deferred();
  const started = deferred();
  const state = fixture({
    search: async (options) => {
      if (options.embedTextsFn === null) {
        assert.strictEqual(options.cacheOrder.length, 12);
        return searchPastSummaries(options);
      }
      started.resolve();
      return semantic.promise;
    },
  });
  const pending = state.controller.searchNow("UNIQUEWORD");
  await started.promise;
  assert.deepStrictEqual(
    state.renders[0].entries.map((e) => e.s),
    ["k0"],
  );
  assert.strictEqual(state.renders.length, 1);
  semantic.resolve([state.cacheOrder[1]]);
  await pending;
  assert.deepStrictEqual(
    state.renders[1].entries.map((e) => e.s),
    ["k1"],
  );
  assert.strictEqual(state.resets(), 0);
});

test("new input invalidates the old query before the debounce expires", async () => {
  const semantic = deferred();
  const started = deferred();
  let oldSignal;
  const state = fixture({
    search: async (options) => {
      if (options.embedTextsFn === null) return [];
      oldSignal = options.signal;
      started.resolve();
      return semantic.promise;
    },
  });
  const pending = state.controller.searchNow("old");
  await started.promise;
  state.controller.input("new");
  assert.ok(oldSignal.aborted);
  assert.strictEqual(state.scheduled.size, 1);
  semantic.resolve([{ s: "stale" }]);
  await pending;
  assert.strictEqual(state.renders.length, 1);
  state.controller.invalidate();
  assert.strictEqual(state.scheduled.size, 0);
});

test("empty input restores recent 8 and never starts semantic work", async () => {
  const state = fixture();
  state.controller.input("queued query");
  state.controller.input("  ");
  await new Promise(setImmediate);
  assert.strictEqual(state.scheduled.size, 0);
  assert.strictEqual(state.calls.length, 0);
  assert.deepStrictEqual(
    state.renders[0].entries.map((e) => e.s),
    ["k11", "k10", "k9", "k8", "k7", "k6", "k5", "k4"],
  );
});

test("an old semantic result cannot replace the newer query results", async () => {
  const semantic = deferred();
  const started = deferred();
  const state = fixture({
    search: async (options) => {
      if (options.query === "new") return [{ s: "new" }];
      if (options.embedTextsFn === null) return [];
      started.resolve();
      return semantic.promise;
    },
  });
  const pending = state.controller.searchNow("old");
  await started.promise;
  await state.controller.searchNow("new");
  semantic.resolve([{ s: "old" }]);
  await pending;
  assert.deepStrictEqual(state.renders.at(-1).entries, [{ s: "new" }]);
  assert.strictEqual(state.renders.length, 3);
});

test("a recent load supersedes an outstanding semantic search", async () => {
  const semantic = deferred();
  const started = deferred();
  const state = fixture({
    search: async (options) => {
      if (options.embedTextsFn === null) return [];
      started.resolve();
      return semantic.promise;
    },
  });
  const pending = state.controller.searchNow("old");
  await started.promise;
  await state.controller.loadRecent();
  semantic.resolve([{ s: "stale" }]);
  await pending;
  assert.deepStrictEqual(
    state.renders.map((render) => render.type),
    ["search", "recent"],
  );
});

test("deletion and clearing invalidate results and reset vectors", async () => {
  for (const nextIndex of [[{ s: "remaining" }], []]) {
    const semantic = deferred();
    const started = deferred();
    let index = [{ s: "deleted" }];
    const state = fixture({
      readIndex: async () => index,
      search: async (options) => {
        if (options.embedTextsFn === null) return index;
        started.resolve();
        return semantic.promise;
      },
    });
    const pending = state.controller.searchNow("query");
    await started.promise;
    state.controller.invalidate({ clearCache: true });
    index = nextIndex;
    await state.controller.loadRecent();
    semantic.resolve([{ s: "deleted" }]);
    await pending;
    assert.strictEqual(state.resets(), 1);
    assert.deepStrictEqual(state.renders.at(-1), {
      type: "recent",
      entries: [...nextIndex].reverse(),
    });
    assert.strictEqual(state.renders.length, 2);
  }
});

test("input supersedes a recent load waiting for storage", async () => {
  const indexRead = deferred();
  const state = fixture({ readIndex: () => indexRead.promise });
  const pending = state.controller.loadRecent();
  state.controller.input("new");
  indexRead.resolve([{ s: "stale" }]);
  await pending;
  assert.deepStrictEqual(state.renders, []);
  state.controller.invalidate();
});

test("popup delete goes through the atomic storage helper (#313)", () => {
  assert.ok(appSource.includes("await removeCachedSummary(entry.s)"));
});

test("popup wires invalidation into delete, clear and local history changes", () => {
  assert.match(
    appSource,
    /pastSummariesController\.invalidate\(\{ clearCache: true \}\);\s+try \{[\s\S]*?await removeCachedSummary\(entry\.s\)/,
  );
  assert.match(
    appSource,
    /async function clearCachedData\(\) \{\s+pastSummariesController\.invalidate\(\{ clearCache: true \}\)/,
  );
  assert.match(
    appSource,
    /!changes\.cacheOrder[\s\S]*?key\.startsWith\("summary:"\)[\s\S]*?pastSummariesController\.invalidate\(\{ clearCache: true \}\)/,
  );
});

test("search finds summaries older than the last 8 (#313)", async () => {
  const cacheOrder = Array.from({ length: 12 }, (_, i) => ({
    s: `k${i}`,
    p: `p${i}`,
    t: `Article ${i}`,
  }));
  const storedSummaries = Object.fromEntries(
    cacheOrder.map((e) => [e.s, `Body text for ${e.s}`]),
  );
  storedSummaries.k0 = "Body text with a UNIQUEWORD cavern-wall ancients";

  const results = await searchPastSummaries({
    query: "UNIQUEWORD",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].s, "k0");
});
