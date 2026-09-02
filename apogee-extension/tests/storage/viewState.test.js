import test from "node:test";
import assert from "node:assert";

import {
  saveViewState,
  saveViewStateIfJobMatches,
  loadViewState,
  clearAllViewStates,
  isViewStateKey,
  removeViewState,
} from "../../lib/storage/viewState.js";
import { hashUrl } from "../../lib/storage/pageCache.js";

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

const CONTENT = {
  view: "summaryView",
  subview: "summary",
  summaryText: "The board approved the merger.",
  question: "What did they decide?",
  answerText: "They approved it.",
};

test("view state keeps page content for an ordinary page", async () => {
  installFakeStorage({ settings: { saveHistory: true } });

  const state = await saveViewState(7, {
    ...CONTENT,
    url: "https://example.com/article",
  });

  assert.strictEqual(state.summaryText, CONTENT.summaryText);
  assert.strictEqual(state.question, CONTENT.question);
  assert.strictEqual(state.answerText, CONTENT.answerText);
});

test("view state scrubs page content on a built-in sensitive host", async () => {
  installFakeStorage({ settings: { saveHistory: true } });

  const state = await saveViewState(7, {
    ...CONTENT,
    url: "https://mail.google.com/mail/u/0/#inbox/abc",
  });

  assert.strictEqual(state.summaryText, undefined);
  assert.strictEqual(state.question, undefined);
  assert.strictEqual(state.answerText, undefined);
  assert.strictEqual(state.view, "summaryView");
});

test("view state scrubs page content on a host the user marked private", async () => {
  installFakeStorage({
    settings: { saveHistory: true, privateHosts: "myclinic.org" },
  });

  const state = await saveViewState(7, {
    ...CONTENT,
    url: "https://portal.myclinic.org/results/2026",
  });

  assert.strictEqual(state.summaryText, undefined);
  assert.strictEqual(state.question, undefined);
  assert.strictEqual(state.answerText, undefined);
});

test("view state scrubs page content when history is turned off", async () => {
  installFakeStorage({ settings: { saveHistory: false } });

  const state = await saveViewState(7, {
    ...CONTENT,
    url: "https://example.com/article",
  });

  assert.strictEqual(state.summaryText, undefined);
});

test("clearAllViewStates drops every tab's state and leaves settings alone", async () => {
  const settings = { saveHistory: true };
  const data = installFakeStorage({ settings });

  await saveViewState(7, { ...CONTENT, url: "https://example.com/article" });
  await saveViewState(9, { ...CONTENT, url: "https://example.com/other" });

  const removed = await clearAllViewStates();

  assert.strictEqual(removed, 3); // two tabs plus the order index
  assert.strictEqual(await loadViewState(7), null);
  assert.strictEqual(await loadViewState(9), null);
  assert.strictEqual(data.viewStateOrder, undefined);
  assert.deepStrictEqual(data.settings, settings);
});

test("view state stores a hash of the url, never the url itself", async () => {
  const url = "https://example.com/reset?token=hunter2";
  const data = installFakeStorage({ settings: { saveHistory: true } });

  await saveViewState(7, { view: "summaryView", url });

  const stored = await loadViewState(7);
  assert.strictEqual(stored.url, undefined);
  assert.strictEqual(stored.urlHash, await hashUrl(url));
  assert.ok(!JSON.stringify(data).includes("hunter2"));
});

test("matching job finalization survives a completion before stream setup", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  const url = "https://example.com/article";

  await saveViewState(7, {
    view: "summaryView",
    subview: "summarizing",
    url,
    jobId: "job-fast",
    streamId: null,
  });

  const completed = await saveViewStateIfJobMatches(
    7,
    "job-fast",
    {
      view: "summaryView",
      subview: "summary",
      url,
      streamId: null,
      summaryText: "The completed result.",
    },
    "summarizing",
  );
  const lateStreamWrite = await saveViewStateIfJobMatches(
    7,
    "job-fast",
    { subview: "summarizing", streamId: "stream-too-late" },
    "summarizing",
  );

  assert.strictEqual(completed.subview, "summary");
  assert.strictEqual(lateStreamWrite, null);
  assert.deepStrictEqual(await loadViewState(7), completed);
});

test("an older job cannot replace a newer job with the same cache key", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  const url = "https://example.com/article";
  const cacheKey = "summary:same-settings";

  await saveViewState(7, {
    view: "summaryView",
    subview: "summarizing",
    url,
    jobId: "job-old",
    streamId: "stream-old",
    cacheKey,
  });
  await saveViewState(7, {
    view: "summaryView",
    subview: "summarizing",
    url,
    jobId: "job-new",
    streamId: "stream-new",
    summaryText: "",
    cacheKey,
  });

  const staleCompletion = await saveViewStateIfJobMatches(
    7,
    "job-old",
    {
      subview: "summary",
      streamId: null,
      summaryText: "Stale result",
    },
    "summarizing",
  );

  assert.strictEqual(staleCompletion, null);
  assert.deepStrictEqual(await loadViewState(7), {
    view: "summaryView",
    subview: "summarizing",
    url: undefined,
    urlHash: await hashUrl(url),
    jobId: "job-new",
    streamId: "stream-new",
    summaryText: "",
    cacheKey,
  });

  const currentCompletion = await saveViewStateIfJobMatches(
    7,
    "job-new",
    {
      subview: "summary",
      streamId: null,
      summaryText: "Current result",
    },
    "summarizing",
  );
  assert.strictEqual(currentCompletion.summaryText, "Current result");
});

test("isViewStateKey recognizes view state keys and order index", () => {
  assert.strictEqual(isViewStateKey("popupViewState:7"), true);
  assert.strictEqual(isViewStateKey("popupViewState:123"), true);
  assert.strictEqual(isViewStateKey("viewStateOrder"), true);
  assert.strictEqual(isViewStateKey("cacheOrder"), false);
  assert.strictEqual(isViewStateKey("settings"), false);
  assert.strictEqual(isViewStateKey("summary:foo"), false);
});

test("loadViewState returns null for missing tab and for null tabId", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  assert.strictEqual(await loadViewState(999), null);
  assert.strictEqual(await loadViewState(null), null);
  assert.strictEqual(await loadViewState(undefined), null);
});

test("saveViewState returns null and writes nothing for null tabId", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });
  const result = await saveViewState(null, { view: "summaryView" });
  assert.strictEqual(result, null);
  assert.strictEqual(data["popupViewState:null"], undefined);
  assert.strictEqual(
    await saveViewState(undefined, { view: "homeView" }),
    null,
  );
});

test("saveViewStateIfJobMatches returns null for falsy jobId", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  assert.strictEqual(
    await saveViewStateIfJobMatches(7, null, { view: "summaryView" }),
    null,
  );
  assert.strictEqual(
    await saveViewStateIfJobMatches(7, "", { view: "summaryView" }),
    null,
  );
  assert.strictEqual(
    await saveViewStateIfJobMatches(7, undefined, { view: "summaryView" }),
    null,
  );
});

test("saveViewStateIfJobMatches respects subview mismatch with same jobId", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  const url = "https://example.com/article";
  await saveViewState(7, {
    view: "summaryView",
    subview: "summarizing",
    url,
    jobId: "job-1",
    streamId: "s1",
  });
  const mismatch = await saveViewStateIfJobMatches(
    7,
    "job-1",
    { subview: "summary", summaryText: "Done" },
    "other-subview",
  );
  assert.strictEqual(mismatch, null);
  assert.strictEqual((await loadViewState(7)).summaryText, undefined);
});

test("removeViewState deletes state and order entry, tolerates null", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });
  await saveViewState(7, { ...CONTENT, url: "https://example.com/a" });
  await saveViewState(9, { ...CONTENT, url: "https://example.com/b" });
  assert.strictEqual(data.viewStateOrder.length, 2);
  await removeViewState(7);
  assert.strictEqual(await loadViewState(7), null);
  assert.deepStrictEqual(data.viewStateOrder, ["popupViewState:9"]);
  assert.notStrictEqual(await loadViewState(9), null);
  await removeViewState(null);
  await removeViewState(undefined);
  assert.deepStrictEqual(data.viewStateOrder, ["popupViewState:9"]);
});

test("saveViewState merges with existing state and keeps order FIFO", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });
  await saveViewState(7, {
    view: "summaryView",
    url: "https://example.com/a",
    jobId: "j1",
  });
  await saveViewState(7, { subview: "summary", summaryText: "merged" });
  const loaded = await loadViewState(7);
  assert.strictEqual(loaded.view, "summaryView");
  assert.strictEqual(loaded.subview, "summary");
  assert.strictEqual(loaded.summaryText, "merged");
  assert.strictEqual(loaded.jobId, "j1");
  assert.strictEqual(data.viewStateOrder.length, 1);
  assert.strictEqual(data.viewStateOrder[0], "popupViewState:7");
});

test("saveViewState without url preserves page-derived fields", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  const state = await saveViewState(7, {
    view: "summaryView",
    question: "Q?",
    answerText: "A.",
    summaryText: "S.",
  });
  assert.strictEqual(state.question, "Q?");
  assert.strictEqual(state.answerText, "A.");
  assert.strictEqual(state.summaryText, "S.");
  assert.strictEqual(state.urlHash, undefined);
});

test("MAX_VIEW_STATES evicts oldest entries FIFO", async () => {
  const data = installFakeStorage({ settings: { saveHistory: true } });
  const total = 51;
  for (let i = 0; i < total; i++) {
    await saveViewState(i, {
      view: "summaryView",
      url: `https://example.com/p/${i}`,
    });
  }
  assert.strictEqual(data.viewStateOrder.length, 50);
  assert.strictEqual(data.viewStateOrder.includes("popupViewState:0"), false);
  assert.strictEqual(data.viewStateOrder.includes("popupViewState:1"), true);
  assert.strictEqual(await loadViewState(0), null);
  assert.notStrictEqual(await loadViewState(1), null);
  assert.notStrictEqual(await loadViewState(50), null);
});

test("clearAllViewStates is idempotent when nothing to clear", async () => {
  installFakeStorage({ settings: { saveHistory: true } });
  const removed = await clearAllViewStates();
  assert.strictEqual(removed, 0);
  const data = installFakeStorage({
    settings: { saveHistory: true },
    viewStateOrder: [],
  });
  assert.strictEqual(await clearAllViewStates(), 1);
  assert.strictEqual(data.viewStateOrder, undefined);
  assert.deepStrictEqual(data.settings, { saveHistory: true });
});
