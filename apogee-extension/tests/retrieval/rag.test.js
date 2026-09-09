import test from "node:test";
import assert from "node:assert";

import {
  retrieveRelevantContent,
  findBestPassage,
  selectSalientChunks,
  ragIndexCacheKey,
} from "../../lib/retrieval/rag.js";

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

test("ragIndexCacheKey prefixes the hash with content length", () => {
  const a = "lorem ipsum dolor sit amet ".repeat(100);
  const b = `${a}extra sentence.`;
  assert.ok(ragIndexCacheKey(a).startsWith(`${a.length}:`));
  assert.ok(ragIndexCacheKey(b).startsWith(`${b.length}:`));
  assert.notStrictEqual(ragIndexCacheKey(a), ragIndexCacheKey(b));
  assert.strictEqual(ragIndexCacheKey(a), ragIndexCacheKey(a));
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

function topicEmbed(texts) {
  return texts.map((t) => {
    const l = t.toLowerCase();
    return [
      l.includes("apple") ? 1 : 0,
      l.includes("banana") ? 1 : 0,
      l.includes("cherry") ? 1 : 0,
    ];
  });
}

test("selectSalientChunks returns chunks unchanged when already within budget", async () => {
  const chunks = ["a", "b"];
  const result = await selectSalientChunks(chunks, 5, {
    embedTextsFn: topicEmbed,
  });
  assert.strictEqual(result, chunks);
});

test("selectSalientChunks covers the document's distinct topics instead of keeping the first N", async () => {
  const chunks = [
    "apple one",
    "apple two",
    "apple three",
    "banana content",
    "cherry content",
  ];
  const result = await selectSalientChunks(chunks, 3, {
    embedTextsFn: topicEmbed,
  });

  assert.strictEqual(result.length, 3);
  assert.ok(
    result.some((c) => c.includes("banana")),
    "must include the banana topic, not only apples",
  );
  assert.ok(
    result.some((c) => c.includes("cherry")),
    "must include the cherry topic, not only apples",
  );
  assert.deepStrictEqual(
    result,
    [...result].sort((a, b) => chunks.indexOf(a) - chunks.indexOf(b)),
  );
});

test("selectSalientChunks returns null if embedding fails (caller falls back)", async () => {
  const result = await selectSalientChunks(["a", "b", "c"], 2, {
    embedTextsFn: () => {
      throw new Error("model unavailable");
    },
  });
  assert.strictEqual(result, null);
});

test("findBestPassage returns the chunk most similar to the query, with a score", async () => {
  const banana = "banana ".repeat(200);
  const carrot = "carrot ".repeat(200);
  const filler = "lorem ipsum dolor sit amet ".repeat(150);
  const content = `${filler}${banana}${filler}${carrot}${filler}`;

  const result = await findBestPassage(
    { content, query: "Tell me about banana" },
    { embedTextsFn: fakeEmbed },
  );

  assert.ok(result);
  assert.ok(result.chunk.toLowerCase().includes("banana"));
  assert.ok(!result.chunk.toLowerCase().includes("carrot"));
  assert.equal(result.score, 1);
});

test("findBestPassage refines a coarse chunk down to the single query-relevant sentence", async () => {
  const filler = "Carrots grow underground and are orange root vegetables. ";
  const bananaSentence =
    "A banana is a long curved yellow tropical fruit that grows in bunches.";
  const content = filler.repeat(6) + bananaSentence + " " + filler.repeat(6);

  const result = await findBestPassage(
    { content, query: "tell me about banana" },
    { embedTextsFn: fakeEmbed },
  );

  assert.ok(result);
  assert.strictEqual(result.chunk, bananaSentence);
  assert.strictEqual(result.score, 1);
});

test("findBestPassage returns null for empty content or query", async () => {
  assert.equal(
    await findBestPassage(
      { content: "", query: "anything" },
      { embedTextsFn: fakeEmbed },
    ),
    null,
  );
  assert.equal(
    await findBestPassage(
      { content: "some real content here", query: "" },
      { embedTextsFn: fakeEmbed },
    ),
    null,
  );
});

test("findBestPassage returns null when embedding fails", async () => {
  const embedTextsFn = () => {
    throw new Error("model unavailable");
  };
  const result = await findBestPassage(
    { content: "some page content", query: "a question" },
    { embedTextsFn },
  );
  assert.equal(result, null);
});

test("findBestPassage shares the cached chunk index with retrieveRelevantContent", async () => {
  const banana = "banana ".repeat(200);
  const filler = "a distinct filler phrase not used elsewhere ".repeat(150);
  const content = `${filler}${banana}${filler}`;

  let indexBuildCalls = 0;
  const embedTextsFn = (texts) => {
    if (texts.length > 1) indexBuildCalls++;
    return fakeEmbed(texts);
  };

  await retrieveRelevantContent(
    { content, question: "banana?", maxContextChars: 500, topK: 1 },
    { embedTextsFn },
  );
  const passage = await findBestPassage(
    { content, query: "banana?" },
    { embedTextsFn },
  );

  assert.equal(indexBuildCalls, 1);
  assert.ok(passage.chunk.toLowerCase().includes("banana"));
});
