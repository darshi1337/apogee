import test from "node:test";
import assert from "node:assert";

function parseQuestions(text) {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "");
  return cleaned
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•\d.)]+\s*/, "")
        .trim()
    )
    .filter((line) => line.length > 0 && line.endsWith("?"))
    .slice(0, 2);
}

test("parseQuestions parses numbered lists", () => {
  const output = "1. What is the main idea?\n2. How does it work?";
  assert.deepEqual(parseQuestions(output), [
    "What is the main idea?",
    "How does it work?",
  ]);
});

test("parseQuestions ignores conversational wrappers without question marks", () => {
  const output = "Here are two questions:\n- What is the main idea?\n- How does it work?\nHope this helps!";
  assert.deepEqual(parseQuestions(output), [
    "What is the main idea?",
    "How does it work?",
  ]);
});

test("parseQuestions ignores empty lines and thinking blocks", () => {
  const output = "<think>\nThinking process...\n</think>\n- What is the main idea?\n\n- How does it work?";
  assert.deepEqual(parseQuestions(output), [
    "What is the main idea?",
    "How does it work?",
  ]);
});
