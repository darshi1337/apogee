import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = [
  "extractors/thread.js",
  "extractors/video.js",
  "extractors/bilibili.js",
];
const VIDEO_URL = "https://www.bilibili.com/video/BV1xx411c7mD";

function biliInitialStateScript(videoData, extras = {}) {
  const state = { videoData, ...extras };
  return `<script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script>`;
}

function videoPage(videoData, extras) {
  return `<!doctype html>
<html>
  <head><title>${videoData.title || "Bilibili"}</title></head>
  <body>${biliInitialStateScript(videoData, extras)}</body>
</html>`;
}

function extract({
  url = VIDEO_URL,
  videoData,
  extras,
  html,
  chromeStub,
} = {}) {
  const resolvedHtml =
    html || videoPage(videoData || defaultVideoData(), extras);
  const { extractBilibili } = loadExtractors({
    files: FILES,
    url,
    html: resolvedHtml,
    chrome: chromeStub || {
      runtime: { sendMessage: async () => ({ segments: [] }) },
    },
  });
  return extractBilibili();
}

function defaultVideoData(overrides = {}) {
  return {
    title: "Understanding Transformers",
    aid: 12345678,
    bvid: "BV1xx411c7mD",
    cid: 99887766,
    duration: 754,
    owner: { name: "Alice" },
    desc: "A deep dive into attention mechanisms.\nhttps://example.com/repo\nWith practical examples.",
    pages: [{ cid: 99887766, duration: 754, part: "Part 1" }],
    ...overrides,
  };
}

test("extractBilibili returns a result with cleaned description and no-subtitle notice when subtitles are empty", async () => {
  const result = await extract();

  assert.strictEqual(result.type, "bilibili");
  assert.strictEqual(result.title, "Understanding Transformers");
  assert.strictEqual(result.url, VIDEO_URL);
  assert.strictEqual(result.durationSeconds, 754);
  assert.match(result.content, /Video Title:\nUnderstanding Transformers/);
  assert.match(result.content, /Uploader: Alice/);
  assert.match(result.content, /Duration: 13 min/);
  assert.match(
    result.content,
    /A deep dive into attention mechanisms\.\nWith practical examples\./,
  );
  assert.doesNotMatch(result.content, /https:\/\/example\.com\/repo/);
  assert.match(result.content, /\(No subtitles\/captions available/);
});

test("extractBilibili includes transcript with timestamp markers when subtitles are returned", async () => {
  const segments = [
    { start: 0, text: "Hello everyone." },
    { start: 10, text: "Today we talk about attention." },
    { start: 25, text: "Self-attention is key." },
    { start: 50, text: "Let us look at an example." },
  ];

  const chromeStub = {
    runtime: { sendMessage: async () => ({ segments }) },
  };

  const result = await extract({ chromeStub });

  assert.match(result.content, /Transcript:/);
  assert.match(result.content, /\[0:00\] Hello everyone\./);
  assert.match(result.content, /\[0:25\] Self-attention is key\./);
  assert.match(result.content, /\[0:50\] Let us look at an example\./);
  assert.doesNotMatch(result.content, /\(No subtitles\/captions available/);
  assert.match(result.content, /Last transcript timestamp: 0:50 \(50s\)/);
});

test("extractBilibili passes correct payload to chrome.runtime.sendMessage", async () => {
  let receivedPayload = null;
  const chromeStub = {
    runtime: {
      sendMessage: async (msg) => {
        receivedPayload = msg;
        return { segments: [] };
      },
    },
  };

  await extract({ chromeStub });

  assert.strictEqual(receivedPayload.target, "service-worker");
  assert.strictEqual(receivedPayload.action, "bilibili-subtitles");
  assert.strictEqual(receivedPayload.payload.aid, 12345678);
  assert.strictEqual(receivedPayload.payload.bvid, "BV1xx411c7mD");
  assert.strictEqual(receivedPayload.payload.cid, 99887766);
  assert.ok(receivedPayload.payload.preferredLang);
});

test("extractBilibili truncates description to 500 chars when transcript is present", async () => {
  const longDesc = "A".repeat(600);
  const segments = [{ start: 0, text: "Hello." }];
  const chromeStub = {
    runtime: { sendMessage: async () => ({ segments }) },
  };

  const result = await extract({
    videoData: defaultVideoData({ desc: longDesc }),
    chromeStub,
  });

  const descMatch = result.content.match(/Description:\n([\s\S]*?)\n\n/);
  assert.ok(descMatch, "description section should exist");
  assert.ok(
    descMatch[1].endsWith("…"),
    "truncated description should end with ellipsis",
  );
  assert.ok(
    descMatch[1].length <= 501,
    "truncated description should be at most 500 chars plus ellipsis",
  );
});

test("extractBilibili keeps full description when no transcript is present", async () => {
  const longDesc = "B".repeat(600);
  const result = await extract({
    videoData: defaultVideoData({ desc: longDesc }),
  });

  assert.match(result.content, new RegExp("B{600}"));
});

test("extractBilibili selects the correct page cid from ?p= parameter", async () => {
  let capturedCid = null;
  const chromeStub = {
    runtime: {
      sendMessage: async (msg) => {
        capturedCid = msg.payload.cid;
        return { segments: [] };
      },
    },
  };

  const pages = [
    { cid: 1001, duration: 300, part: "Part 1" },
    { cid: 1002, duration: 400, part: "Part 2" },
    { cid: 1003, duration: 500, part: "Part 3" },
  ];

  await extract({
    url: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
    videoData: defaultVideoData({ pages, cid: 1001 }),
    chromeStub,
  });

  assert.strictEqual(capturedCid, 1002);
});

test("extractBilibili uses page 1 when no ?p= parameter is set", async () => {
  let capturedCid = null;
  const chromeStub = {
    runtime: {
      sendMessage: async (msg) => {
        capturedCid = msg.payload.cid;
        return { segments: [] };
      },
    },
  };

  const pages = [
    { cid: 2001, duration: 300, part: "Part 1" },
    { cid: 2002, duration: 400, part: "Part 2" },
  ];

  await extract({
    videoData: defaultVideoData({ pages, cid: 2001 }),
    chromeStub,
  });

  assert.strictEqual(capturedCid, 2001);
});

test("extractBilibili returns null for homepage (no __INITIAL_STATE__ with videoData)", async () => {
  const result = await extract({
    url: "https://www.bilibili.com/",
    html: `<!doctype html><html><body><script>var __INITIAL_STATE__={"foo":"bar"};</script></body></html>`,
  });
  assert.strictEqual(result, null);
});

test("extractBilibili returns null for user space page", async () => {
  const result = await extract({
    url: "https://space.bilibili.com/12345",
    html: `<!doctype html><html><body><p>User profile</p></body></html>`,
  });
  assert.strictEqual(result, null);
});

test("extractBilibili returns null for live room page", async () => {
  const result = await extract({
    url: "https://live.bilibili.com/12345",
    html: `<!doctype html><html><body><p>Live stream</p></body></html>`,
  });
  assert.strictEqual(result, null);
});

test("extractBilibili returns null when videoData has no title", async () => {
  const result = await extract({
    videoData: defaultVideoData({ title: "" }),
  });
  assert.strictEqual(result, null);
});

test("extractBilibili handles missing owner gracefully", async () => {
  const result = await extract({
    videoData: defaultVideoData({ owner: null }),
  });

  assert.strictEqual(result.type, "bilibili");
  assert.doesNotMatch(result.content, /Uploader:/);
});

test("extractBilibili gracefully handles sendMessage failure", async () => {
  const chromeStub = {
    runtime: {
      sendMessage: async () => {
        throw new Error("Extension context invalidated");
      },
    },
  };

  const result = await extract({ chromeStub });

  assert.strictEqual(result.type, "bilibili");
  assert.match(result.content, /\(No subtitles\/captions available/);
});

test("biliFormatTimestamp formats hours correctly in transcript markers", async () => {
  const segments = [
    { start: 0, text: "Start." },
    { start: 3661, text: "Over an hour in." },
  ];
  const chromeStub = {
    runtime: { sendMessage: async () => ({ segments }) },
  };

  const result = await extract({ chromeStub });

  assert.match(result.content, /\[0:00\] Start\./);
  assert.match(result.content, /\[1:01:01\] Over an hour in\./);
});
