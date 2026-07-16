import test from "node:test";
import assert from "node:assert";

import { parseSuggestedQuestions } from "../src/routes/summarize.js";

test("parseSuggestedQuestions handles numbered questions", () => {
  const text = "1. What is the main thesis?\n2. How is this validated?";
  assert.deepStrictEqual(parseSuggestedQuestions(text), [
    "What is the main thesis?",
    "How is this validated?",
  ]);
});

test("parseSuggestedQuestions handles bulleted questions", () => {
  const text = "- What is the main thesis?\n* How is this validated?";
  assert.deepStrictEqual(parseSuggestedQuestions(text), [
    "What is the main thesis?",
    "How is this validated?",
  ]);
});

test("parseSuggestedQuestions ignores an intro line", () => {
  const text = [
    "Here are two suggested questions:",
    "- What is the main thesis?",
    "- How is this validated?",
  ].join("\n");
  assert.deepStrictEqual(parseSuggestedQuestions(text), [
    "What is the main thesis?",
    "How is this validated?",
  ]);
});

test("parseSuggestedQuestions skips non-question lines", () => {
  const text = [
    "1. This is not a question.",
    "1. What is the main thesis?",
    "2. How is this validated?",
  ].join("\n");
  assert.deepStrictEqual(parseSuggestedQuestions(text), [
    "What is the main thesis?",
    "How is this validated?",
  ]);
});
