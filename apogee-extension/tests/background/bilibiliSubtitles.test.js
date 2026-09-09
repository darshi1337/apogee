import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import {
  MAX_BILIBILI_SUBTITLE_CHARS,
  MAX_BILIBILI_SUBTITLE_SEGMENTS,
} from "../../lib/extract/fileLimits.js";

const { chrome } = createExtensionApiMock({
  settings: {
    saveHistory: true,
  },
});
chrome.permissions = {
  contains: (_req, cb) => cb(true),
};
globalThis.chrome = chrome;

const { fetchBilibiliSubtitles } =
  await import("../../background/service-worker.js");

const ARGS = { aid: "12345", cid: "67890", preferredLang: "en" };
const TRACK_URL = "https://xy123.hdslb.com/track.json";

function mockFetch(trackBody) {
  return async (url) => {
    const text = url.toString();
    const payload = text.includes("api.bilibili.com")
      ? {
          data: {
            subtitle: { subtitles: [{ lan: "en", subtitle_url: TRACK_URL }] },
          },
        }
      : { body: trackBody };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
}

function seg(i) {
  return { from: i * 2.5, content: ` hello  world ${i} ` };
}

test("fetchBilibiliSubtitles normalizes small tracks", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch([seg(0), seg(1), { from: 5, content: "   " }]);
  try {
    const result = await fetchBilibiliSubtitles(ARGS);
    assert.deepStrictEqual(result, [
      { start: 0, text: "hello world 0" },
      { start: 2.5, text: "hello world 1" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchBilibiliSubtitles caps runaway segment counts", async () => {
  assert.strictEqual(MAX_BILIBILI_SUBTITLE_SEGMENTS, 5000);
  const originalFetch = globalThis.fetch;
  const oversized = Array.from(
    { length: MAX_BILIBILI_SUBTITLE_SEGMENTS + 1000 },
    (_, i) => seg(i),
  );
  globalThis.fetch = mockFetch(oversized);
  try {
    const result = await fetchBilibiliSubtitles(ARGS);
    assert.strictEqual(result.length, MAX_BILIBILI_SUBTITLE_SEGMENTS);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchBilibiliSubtitles caps total characters", async () => {
  assert.strictEqual(MAX_BILIBILI_SUBTITLE_CHARS, 500 * 1024);
  const originalFetch = globalThis.fetch;
  const big = Array.from({ length: 100 }, (_, i) => ({
    from: i,
    content: "x".repeat(10 * 1024),
  }));
  globalThis.fetch = mockFetch(big);
  try {
    const result = await fetchBilibiliSubtitles(ARGS);
    const total = result.reduce((n, s) => n + s.text.length, 0);
    assert.ok(total <= MAX_BILIBILI_SUBTITLE_CHARS);
    assert.ok(result.length < big.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchBilibiliSubtitles rejects invalid input without fetching", async () => {
  let fetched = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetched++;
    return originalFetch(...args);
  };
  try {
    assert.deepStrictEqual(await fetchBilibiliSubtitles({}), []);
    assert.deepStrictEqual(
      await fetchBilibiliSubtitles({ aid: "1", cid: "not-a-number" }),
      [],
    );
    assert.strictEqual(fetched, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
