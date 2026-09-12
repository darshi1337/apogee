import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ABSOLUTE_MAP_CHUNKS,
  MAX_INGRESS_CONTENT_CHARS,
  MAX_INGRESS_PROMPT_CHARS,
  MAX_INGRESS_QUESTION_CHARS,
  MAX_INGRESS_TITLE_CHARS,
  MAX_INGRESS_URL_CHARS,
  MAX_STREAM_TEXT_CHARS,
  appendStreamTextCapped,
  assertIngressPayloadOk,
} from "../../lib/extract/fileLimits.js";
import { mapReduceStream } from "../../lib/summarize/mapReduce.js";

test("ingress ceilings reuse the prompt-fencing and finalize backstops (#269)", () => {
  assert.equal(MAX_INGRESS_TITLE_CHARS, 500);
  assert.equal(MAX_INGRESS_URL_CHARS, 2000);
  assert.equal(MAX_INGRESS_QUESTION_CHARS, 2000);
  assert.equal(MAX_INGRESS_CONTENT_CHARS, 1024 * 1024);
  assert.equal(MAX_INGRESS_PROMPT_CHARS, 1024 * 1024);
  assert.equal(MAX_STREAM_TEXT_CHARS, 1024 * 1024);
  assert.equal(MAX_ABSOLUTE_MAP_CHUNKS, 64);
});

test("assertIngressPayloadOk passes payloads at the ceiling (#269)", () => {
  assertIngressPayloadOk({
    content: "x".repeat(MAX_INGRESS_CONTENT_CHARS),
    question: "q".repeat(MAX_INGRESS_QUESTION_CHARS),
    title: "t".repeat(MAX_INGRESS_TITLE_CHARS),
    url: "u".repeat(MAX_INGRESS_URL_CHARS),
  });
  assertIngressPayloadOk({});
  assertIngressPayloadOk({ content: undefined, question: null });
});

test("assertIngressPayloadOk rejects oversize fields with UserFacingError (#269)", () => {
  for (const payload of [
    { content: "x".repeat(MAX_INGRESS_CONTENT_CHARS + 1) },
    { question: "q".repeat(MAX_INGRESS_QUESTION_CHARS + 1) },
    { query: "q".repeat(MAX_INGRESS_QUESTION_CHARS + 1) },
    { title: "t".repeat(MAX_INGRESS_TITLE_CHARS + 1) },
    { url: "u".repeat(MAX_INGRESS_URL_CHARS + 1) },
    { summary: "s".repeat(MAX_INGRESS_CONTENT_CHARS + 1) },
    { prompt: "p".repeat(MAX_INGRESS_PROMPT_CHARS + 1) },
  ]) {
    assert.throws(
      () => assertIngressPayloadOk(payload),
      (err) => {
        assert.equal(err.isUserFacing, true);
        assert.match(err.message, /character limit/);
        return true;
      },
    );
  }
});

test("appendStreamTextCapped bounds live accumulation pre-cap (#269)", () => {
  const small = appendStreamTextCapped("hello ", "world");
  assert.equal(small.text, "hello world");
  assert.equal(small.truncated, false);

  const capped = appendStreamTextCapped(
    "a".repeat(MAX_STREAM_TEXT_CHARS - 5),
    "b".repeat(100),
  );
  assert.equal(capped.text.length, MAX_STREAM_TEXT_CHARS);
  assert.equal(capped.truncated, true);
});

test("mapReduceStream hard-caps mapped chunks so hostile input cannot fan out (#269)", async () => {
  let calls = 0;
  async function* chatStreamFn() {
    calls += 1;
    yield "x";
  }
  const chunks = Array.from(
    { length: MAX_ABSOLUTE_MAP_CHUNKS + 36 },
    (_, i) => `c${i}`,
  );
  const progress = [];
  const out = [];
  for await (const token of mapReduceStream(
    { text: "irrelevant", model: "m", host: "h" },
    {
      chunkTextFn: () => chunks,
      chatStreamFn,
      onProgress: (p) => progress.push(p),
    },
    {
      buildSingle: (c) => `SINGLE: ${c}`,
      buildMap: (c, i, t) => `MAP[${i}/${t}]: ${c}`,
      buildReduce: (ps) => `REDUCE(${ps.length}): ${ps.join(" | ")}`,
    },
  )) {
    out.push(token);
  }

  assert.ok(
    progress.some(
      (p) =>
        p.stage === "truncated" &&
        p.kept === MAX_ABSOLUTE_MAP_CHUNKS &&
        p.total === chunks.length,
    ),
    "absolute cap must emit a truncated event with kept/total",
  );
  // 64 map + tree + final stays bounded; uncapped it would be 100 map calls.
  assert.ok(calls < 100, `expected bounded calls, saw ${calls}`);
  assert.ok(out.length >= 1);
});
