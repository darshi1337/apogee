import test from "node:test";
import assert from "node:assert";

import { chunkText } from "../src/services/chunkService.js";

test("chunkText returns short text unchanged", () => {
  const text = "Short text.";
  assert.deepStrictEqual(chunkText(text, 5000), [text]);
});

test("chunkText splits long text at sentence boundaries", () => {
  const text = "Sentence one. Sentence two. Sentence three.";
  const chunks = chunkText(text, 5);
  assert.ok(chunks.length > 1);
  assert.strictEqual(
    chunks.join("").replace(/ /g, ""),
    text.replace(/ /g, ""),
  );
});
