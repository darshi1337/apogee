import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

// Mirrors the file list `lib/extract/pageExtraction.js` injects, so the dispatcher sees the same global scope it does in a real tab.
const INJECTED_FILES = [
  "Readability.js",
  "extractors/generic.js",
  "extractors/youtube.js",
  "extractors/bilibili.js",
  "extractors/gmail.js",
  "extractors/thread.js",
  "extractors/hackernews.js",
  "extractors/reddit.js",
  "extractors/lobsters.js",
  "extractors/github.js",
  "extractors/gitlab.js",
  "extractors/wikipedia.js",
  "extractors/arxiv.js",
  "extractors/mastodon.js",
  "extractors/stackoverflow.js",
  "extractors/lemmy.js",
  "extractors/discourse.js",
  "extractors/bluesky.js",
  "content.js",
];

const LOOKALIKE_HTML = `<!doctype html>
<html>
  <head><title>A Page That Merely Looks Like YouTube</title></head>
  <body>
    <main>
      <h1>A Page That Merely Looks Like YouTube</h1>
      <p>This page lives on a host that ends in youtube.com but is not the video site, so it must not be handed to the YouTube extractor or sent to YouTube's transcript endpoints.</p>
    </main>
  </body>
</html>`;

test("look-alike hosts are not routed to the YouTube extractor", async () => {
  const lookalikes = [
    "https://youtube.com.example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.attacker.tld/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.example.co/watch?v=dQw4w9WgXcQ",
  ];

  for (const url of lookalikes) {
    const fetched = [];
    const sent = [];
    const { extractPageContent } = loadExtractors({
      files: INJECTED_FILES,
      url,
      html: LOOKALIKE_HTML,
      fetch: async (target) => {
        fetched.push(target);
        return { ok: true, text: async () => "" };
      },
      chrome: {
        runtime: {
          sendMessage: async (message) => {
            sent.push(message);
            return { segments: [] };
          },
          onMessage: { addListener: () => {} },
        },
      },
    });

    const result = await extractPageContent();

    assert.notStrictEqual(result.type, "youtube", `${url} routed to YouTube`);
    assert.strictEqual(result.url, url);
    assert.deepStrictEqual(fetched, [], `${url} made network requests`);
    assert.deepStrictEqual(
      sent,
      [],
      `${url} reached the sponsorblock service worker`,
    );
  }
});

test("the real YouTube host is routed to the YouTube extractor", async () => {
  const html = `<!doctype html>
<html>
  <head><title>Test Video Title - YouTube</title></head>
  <body>
    <script>
      var ytInitialPlayerResponse = ${JSON.stringify({
        videoDetails: { title: "Extracted Video Title", author: "Creator" },
      })};
    </script>
  </body>
</html>`;

  const { extractPageContent } = loadExtractors({
    files: INJECTED_FILES,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    html,
    fetch: async () => ({ ok: true, text: async () => "" }),
    chrome: {
      runtime: {
        sendMessage: async () => ({ segments: [] }),
        onMessage: { addListener: () => {} },
      },
    },
  });

  const result = await extractPageContent();

  assert.strictEqual(result.type, "youtube");
  assert.strictEqual(result.title, "Extracted Video Title");
  assert.strictEqual(result.isPdf, false);
});
