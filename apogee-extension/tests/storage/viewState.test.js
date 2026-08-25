import test from "node:test";
import assert from "node:assert";

import {
  saveViewState,
  saveViewStateIfJobMatches,
  loadViewState,
  clearAllViewStates,
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
