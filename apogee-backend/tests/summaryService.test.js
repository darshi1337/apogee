import test from "node:test";
import assert from "node:assert";

import { summarizeText, MAX_CHUNKS } from "../src/services/summaryService.js";
import { chunkText } from "../src/services/chunkService.js";
import { LLMError } from "../src/services/llmService.js";

async function* streamOf(parts) {
  for (const part of parts) yield part;
}

test("summarizeText streams bullets incrementally per chunk", async () => {
  const streams = [
    streamOf(["- Bullet 1", "\n- Bullet 2", "\n"]),
    streamOf(["* Bullet 3", "\n", "This line is not a bullet", "\n* Bullet 4"]),
  ];
  let call = 0;
  const generateStreamFn = () => streams[call++];
  const chunkTextFn = () => ["chunk one text", "chunk two text"];

  const results = [];
  for await (const token of summarizeText(
    {
      text: "full raw text",
      title: "test title",
      url: "http://test.com",
      mode: "bullets",
      model: "qwen3:8b",
    },
    { chunkTextFn, generateStreamFn },
  )) {
    results.push(token);
  }

  assert.deepStrictEqual(results, [
    "- Bullet 1\n",
    "- Bullet 2\n",
    "* Bullet 3\n",
    "* Bullet 4\n",
  ]);
});

test("summarizeText keeps numbered bullet lines from multi-chunk output, not just symbol markers", async () => {
  const streams = [
    streamOf(["1. Bullet one", "\n2. Bullet two", "\n"]),
    streamOf(["3) Bullet three", "\n"]),
  ];
  let call = 0;
  const generateStreamFn = () => streams[call++];
  const chunkTextFn = () => ["chunk one text", "chunk two text"];

  const results = [];
  for await (const token of summarizeText(
    {
      text: "full raw text",
      title: "t",
      url: "http://test.com",
      mode: "bullets",
      model: "qwen3:8b",
    },
    { chunkTextFn, generateStreamFn },
  )) {
    results.push(token);
  }

  assert.deepStrictEqual(results, [
    "1. Bullet one\n",
    "2. Bullet two\n",
    "3) Bullet three\n",
  ]);
});

test("summarizeText re-chunks until the MAX_CHUNKS bound holds even with long sentences", async () => {
  // 500KB made of sentences each just over half of the initial re-chunk
  // target size, a single re-chunk pass at that size still packs only
  // ~1 sentence per chunk, blowing past MAX_CHUNKS again unless the target
  // keeps growing.
  const target = Math.ceil(500_000 / MAX_CHUNKS);
  const sentence = "a".repeat(Math.floor(target * 0.51)) + ". ";
  let text = "";
  while (text.length < 500_000) text += sentence;
  text = text.slice(0, 500_000);

  let callCount = 0;
  async function* stubStream() {
    callCount++;
    yield "summary.\n";
  }

  const results = [];
  for await (const token of summarizeText(
    {
      text,
      title: "t",
      url: "http://test.com",
      mode: "sentences",
      model: "qwen3:8b",
    },
    { chunkTextFn: chunkText, generateStreamFn: stubStream },
  )) {
    results.push(token);
  }

  // One call per chunk, plus one merge call at the end.
  assert.ok(
    callCount <= MAX_CHUNKS + 1,
    `expected at most ${MAX_CHUNKS + 1} model calls, got ${callCount}`,
  );
});

test("summarizeText surfaces LLMError mid-stream instead of throwing", async () => {
  // eslint-disable-next-line require-yield
  async function* failingStream() {
    throw new LLMError("model unreachable");
  }
  const generateStreamFn = () => failingStream();
  const chunkTextFn = () => ["only chunk"];

  const results = [];
  for await (const token of summarizeText(
    {
      text: "raw text",
      title: "t",
      url: "http://test.com",
      mode: "sentences",
      model: "qwen3:8b",
    },
    { chunkTextFn, generateStreamFn },
  )) {
    results.push(token);
  }

  assert.deepStrictEqual(results, ["\n\n[Error: model unreachable]"]);
});
