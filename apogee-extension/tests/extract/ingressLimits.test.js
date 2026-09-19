import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ABSOLUTE_MAP_CHUNKS,
  MAX_STREAM_TEXT_CHARS,
  appendStreamTextCapped,
} from "../../lib/extract/fileLimits.js";
import { mapReduceStream } from "../../lib/summarize/mapReduce.js";

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
