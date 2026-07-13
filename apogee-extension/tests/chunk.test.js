import test from "node:test";
import assert from "node:assert";
import { chunkText, truncateForPrompt } from "../lib/chunk.js";

test("chunkText splits text within maxChars limits", () => {
  const text = "hello world";
  const chunks = chunkText(text, 5);
  assert.deepEqual(chunks, ["hello", "world"]);
});

test("chunkText returns empty array for empty inputs", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText(null), []);
});

test("truncateForPrompt truncates correctly", () => {
  const text = "This is a long string";
  const result = truncateForPrompt(text, 10);
  assert.ok(result.includes("[...content truncated...]"));
  assert.ok(result.length <= 10 + 28); // 10 chars + suffix length
});
