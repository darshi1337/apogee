import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/bluesky.js"];

const BLUESKY_URL =
  "https://bsky.app/profile/alice.bsky.social/post/3l6pyiu4dws2p";

const GET_POST_THREAD_RESPONSE = {
  thread: {
    $type: "app.bsky.feed.defs#threadViewPost",
    post: {
      $type: "app.bsky.feed.defs#postView",
      likeCount: 42,
      author: {
        did: "did:plc:alice",
        handle: "alice.bsky.social",
        displayName: "Alice",
      },
      record: {
        $type: "app.bsky.post",
        text: "Local-first summarizers beat cloud extensions on privacy.",
        createdAt: "2026-08-30T12:00:00Z",
      },
      indexerAt: "2026-08-30T12:00:01Z",
    },
    replies: [
      {
        $type: "app.bsky.feed.defs#threadViewPost",
        post: {
          $type: "app.bsky.feed.defs#postView",
          likeCount: 5,
          author: {
            did: "did:plc:bob",
            handle: "bob.bsky.team",
            displayName: "Bob",
          },
          record: {
            $type: "app.bsky.post",
            text: "Strong agree. The on-device WebGPU path is finally fast enough.",
            createdAt: "2026-08-30T12:05:00Z",
          },
        },
        replies: [
          {
            $type: "app.bsky.feed.defs#threadViewPost",
            post: {
              $type: "app.bsky.feed.defs#postView",
              likeCount: 2,
              author: {
                did: "did:plc:carol",
                handle: "carol.bsky.social",
                displayName: "Carol",
              },
              record: {
                $type: "app.bsky.post",
                text: "Even on WebAssembly it feels snappy for short pages.",
                createdAt: "2026-08-30T12:07:00Z",
              },
            },
            replies: [],
          },
        ],
      },
    ],
  },
};

test("extractBluesky pulls the thread from the AT Protocol public API", async () => {
  const fetched = [];
  const { extractBluesky } = loadExtractors({
    files: FILES,
    url: BLUESKY_URL,
    html: "<html><body><p>empty SPA</p></body></html>",
    fetch: async (target) => {
      fetched.push(target);
      return {
        ok: true,
        json: async () => GET_POST_THREAD_RESPONSE,
      };
    },
  });

  const result = await extractBluesky();

  assert.ok(result, "API response should produce a result");
  assert.strictEqual(result.type, "bluesky");
  assert.strictEqual(result.url, BLUESKY_URL);
  assert.strictEqual(
    result.title,
    "Bluesky post by Alice (@alice.bsky.social)",
  );
  assert.match(result.content, /^Bluesky discussion/);
  assert.match(result.content, /Author: Alice \(@alice\.bsky\.social\)/);
  assert.match(result.content, /Engagement: 42 likes/);
  assert.match(
    result.content,
    /Local-first summarizers beat cloud extensions on privacy\./,
  );
  assert.match(result.content, /\[1\][^\n]*Bob[^\n]*Strong agree/);
  assert.match(result.content, /\[1\.1\][^\n]*Carol[^\n]*Even on WebAssembly/);

  // The single fetch should target the public API with the right URI.
  assert.strictEqual(fetched.length, 1);
  const callUrl = fetched[0];
  assert.match(callUrl, /^https:\/\/public\.api\.bsky\.app\//);
  assert.match(
    callUrl,
    /uri=at%3A%2F%2Falice\.bsky\.social%2Fapp\.bsky\.post\.post%2F3l6pyiu4dws2p/,
  );
});

test("extractBluesky falls back to the rendered DOM when the API fails", async () => {
  const fetched = [];
  const { extractBluesky } = loadExtractors({
    files: FILES,
    url: BLUESKY_URL,
    fixture: "bluesky-thread.html",
    fetch: async (target) => {
      fetched.push(target);
      return { ok: false, status: 503 };
    },
  });

  const result = await extractBluesky();

  assert.ok(result, "DOM fallback should produce a result");
  assert.strictEqual(result.type, "bluesky");
  assert.strictEqual(result.url, BLUESKY_URL);
  assert.match(result.content, /Bluesky discussion/);
  assert.match(
    result.content,
    /Local-first summarizers beat cloud extensions on privacy\./,
  );
  // The fixture has the OP plus two replies. linkedom flattens the DOM
  // tree, so depth tracking is best-effort here; we just verify that
  // both reply bodies appear in the rendered output.
  assert.match(result.content, /Strong agree\./);
  assert.match(result.content, /Even on WebAssembly/);
  // The API was attempted once and the DOM path produced the result.
  assert.strictEqual(fetched.length, 1);
});

test("extractBluesky returns null on a non-Bluesky host", async () => {
  const { extractBluesky } = loadExtractors({
    files: FILES,
    url: "https://example.com/article",
    html: "<html><body><h1>Hello</h1></body></html>",
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });

  const result = await extractBluesky();
  assert.strictEqual(result, null);
});

test("extractBluesky returns null when the API marks the thread as not found", async () => {
  const { extractBluesky } = loadExtractors({
    files: FILES,
    url: BLUESKY_URL,
    html: "<html><body><p>empty SPA</p></body></html>",
    fetch: async () => ({
      ok: true,
      json: async () => ({
        thread: { $type: "app.bsky.feed.defs#notFoundPost" },
      }),
    }),
  });

  const result = await extractBluesky();
  assert.strictEqual(result, null);
});
