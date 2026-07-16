import test from "node:test";
import assert from "node:assert";

import {
  buildAnswerPrompt,
  buildSuggestedQuestionsPrompt,
  buildSummaryPrompt,
} from "../src/services/promptService.js";

test("buildSummaryPrompt substitutes fields and the style block", () => {
  const prompt = buildSummaryPrompt({
    title: "My Title",
    url: "http://example.com",
    content: "Body text",
    mode: "bullets",
  });
  assert.ok(prompt.includes("My Title"));
  assert.ok(prompt.includes("http://example.com"));
  assert.ok(prompt.includes("Body text"));
  assert.ok(prompt.includes("Output 8-14 concise bullet points."));
});

test("buildSummaryPrompt falls back to bullets style for an unknown mode", () => {
  const prompt = buildSummaryPrompt({
    title: "t",
    url: "u",
    content: "c",
    mode: "unknown-mode",
  });
  assert.ok(prompt.includes("Output 8-14 concise bullet points."));
});

test("buildAnswerPrompt substitutes the question field", () => {
  const prompt = buildAnswerPrompt({
    title: "t",
    url: "u",
    content: "c",
    question: "What is this about?",
  });
  assert.ok(prompt.includes("What is this about?"));
});

test("buildSuggestedQuestionsPrompt substitutes the summary field", () => {
  const prompt = buildSuggestedQuestionsPrompt({
    title: "t",
    url: "u",
    summary: "A brief summary.",
  });
  assert.ok(prompt.includes("A brief summary."));
});
