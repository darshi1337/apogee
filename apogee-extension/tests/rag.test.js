import test from "node:test";
import assert from "node:assert";

import { retrieveRelevantContent } from "../lib/rag.js";

// Fake 2-D "embedding": [1,0] if the text mentions banana, [0,1] if it
// mentions carrot, [0,0] otherwise. A question about banana then scores
// highest (dot product) against banana-containing chunks, same shape as
// real cosine similarity between normalized vectors.
function fakeEmbed(texts) {
  return texts.map((t) => {
    const lower = t.toLowerCase();
    return [lower.includes("banana") ? 1 : 0, lower.includes("carrot") ? 1 : 0];
  });
}

test("retrieveRelevantContent returns short content unchanged without embedding", async () => {
  const content = "Short page content.";
  let calls = 0;
  const embedTextsFn = (texts) => {
    calls++;
    return fakeEmbed(texts);
  };

  const result = await retrieveRelevantContent(
    { content, question: "anything?" },
    { embedTextsFn },
  );

  assert.equal(result, content);
  assert.equal(calls, 0);
});

test("retrieveRelevantContent picks the chunk relevant to the question", async () => {
  const banana = "banana ".repeat(200);
  const carrot = "carrot ".repeat(200);
  const filler = "lorem ipsum dolor sit amet ".repeat(150);
  const content = `${filler}${banana}${filler}${carrot}${filler}`;

  const result = await retrieveRelevantContent(
    {
      content,
      question: "What about banana?",
      maxContextChars: 500,
      topK: 1,
    },
    { embedTextsFn: fakeEmbed },
  );

  assert.ok(result.toLowerCase().includes("banana"));
  assert.ok(!result.toLowerCase().includes("carrot"));
});

test("retrieveRelevantContent reuses cached chunk embeddings across questions", async () => {
  const kiwi = "kiwi ".repeat(200);
  const mango = "mango ".repeat(200);
  const filler = "the quick brown fox jumps over ".repeat(150);
  const content = `${filler}${kiwi}${filler}${mango}${filler}`;

  let indexBuildCalls = 0;
  const embedTextsFn = (texts) => {
    if (texts.length > 1) indexBuildCalls++;
    return fakeEmbed(texts);
  };

  await retrieveRelevantContent(
    { content, question: "kiwi?", maxContextChars: 500, topK: 1 },
    { embedTextsFn },
  );
  await retrieveRelevantContent(
    { content, question: "mango?", maxContextChars: 500, topK: 1 },
    { embedTextsFn },
  );

  assert.equal(indexBuildCalls, 1);
});

test("retrieveRelevantContent falls back to truncation if embedding fails", async () => {
  const content = "x".repeat(7000);
  const embedTextsFn = () => {
    throw new Error("model unavailable");
  };

  const result = await retrieveRelevantContent(
    { content, question: "anything?", maxContextChars: 100 },
    { embedTextsFn },
  );

  assert.ok(result.includes("[...content truncated...]"));
  assert.ok(result.length <= 100 + 30);
});
