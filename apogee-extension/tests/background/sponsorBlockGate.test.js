import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

const { chrome } = createExtensionApiMock({
  settings: { useSponsorBlock: false },
});
chrome.permissions = {
  contains(_opts, callback) {
    callback(true);
  },
};
chrome.offscreen = {
  createDocument: async () => {},
  closeDocument: async () => {},
};
chrome.runtime.getContexts = async () => [
  { contextType: "OFFSCREEN_DOCUMENT" },
];
chrome.alarms = {
  create: () => {},
  clear: () => {},
};
globalThis.chrome = chrome;

const { fetchSponsorBlockSegments } =
  await import("../../background/service-worker.js");

const VIDEO_ID = "dQw4w9WgXcQ";

test("fetchSponsorBlockSegments skips the lookup when Stay-fully-local is on", async () => {
  await chrome.storage.local.set({ settings: { useSponsorBlock: false } });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("must not fetch");
  };
  try {
    assert.deepStrictEqual(await fetchSponsorBlockSegments(VIDEO_ID), []);
    assert.strictEqual(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchSponsorBlockSegments still serves lookups when the setting is on", async () => {
  await chrome.storage.local.set({ settings: { useSponsorBlock: true } });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => [
        {
          videoID: VIDEO_ID,
          segments: [
            { category: "sponsor", segment: [10, 20] },
            { category: "intro", segment: [0, 5] },
          ],
        },
      ],
    };
  };
  try {
    assert.deepStrictEqual(await fetchSponsorBlockSegments(VIDEO_ID), [
      [10, 20],
    ]);
    assert.strictEqual(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
