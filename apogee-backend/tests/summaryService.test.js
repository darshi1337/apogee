import test from "node:test";
import assert from "node:assert";

import { summarizeText } from "../src/services/summaryService.js";
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
    { text: "full raw text", title: "test title", url: "http://test.com", mode: "bullets", model: "qwen3:8b" },
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

test("summarizeText surfaces LLMError mid-stream instead of throwing", async () => {
  // eslint-disable-next-line require-yield
  async function* failingStream() {
    throw new LLMError("model unreachable");
  }
  const generateStreamFn = () => failingStream();
  const chunkTextFn = () => ["only chunk"];

  const results = [];
  for await (const token of summarizeText(
    { text: "raw text", title: "t", url: "http://test.com", mode: "sentences", model: "qwen3:8b" },
    { chunkTextFn, generateStreamFn },
  )) {
    results.push(token);
  }

  assert.deepStrictEqual(results, ["\n\n[Error: model unreachable]"]);
});
