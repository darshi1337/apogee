import test from "node:test";
import assert from "node:assert";

import { parseSuggestedQuestions as parseQuestions } from "../lib/questions.js";

test("parseQuestions parses numbered lists", () => {
  const output = "1. What is the main idea?\n2. How does it work?";
  assert.deepEqual(parseQuestions(output), [
    "What is the main idea?",
    "How does it work?",
  ]);
});

test("parseQuestions ignores conversational wrappers without question marks", () => {
  const output =
    "Here are two questions:\n- What is the main idea?\n- How does it work?\nHope this helps!";
  assert.deepEqual(parseQuestions(output), [
    "What is the main idea?",
    "How does it work?",
  ]);
});

test("parseQuestions ignores empty lines and thinking blocks", () => {
  const output =
    "<think>\nThinking process...\n</think>\n- What is the main idea?\n\n- How does it work?";
  assert.deepEqual(parseQuestions(output), [
    "What is the main idea?",
    "How does it work?",
  ]);
});

test("parseQuestions does not eat leading digits from a real question", () => {
  // The old regex (`[-*•\d.)]+` as a character class, not requiring the
  // digits to be followed by "." or ")") stripped bare leading digits too,
  // turning "2025 predictions?" into "predictions?".
  const output = "1. 2025 predictions?\n2. 3D printing uses?";
  assert.deepEqual(parseQuestions(output), [
    "2025 predictions?",
    "3D printing uses?",
  ]);
});

test("parseQuestions handles compound markers and numbering past 2", () => {
  const output = "- 3. What is the main idea?\n4) How does it work?";
  assert.deepEqual(parseQuestions(output), [
    "What is the main idea?",
    "How does it work?",
  ]);
});
