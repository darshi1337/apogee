import test from "node:test";
import assert from "node:assert";
import { formatTimeSaved } from "../lib/readingTime.js";

function words(n) {
  return Array(n).fill("word").join(" ");
}

test("formatTimeSaved reports whole minutes for a long article vs a short summary", () => {
  const result = formatTimeSaved(words(2250), words(50));
  assert.strictEqual(result, "~10 min saved");
});

test("formatTimeSaved reports seconds when the gap is under a minute", () => {
  const result = formatTimeSaved(words(300), words(100));
  assert.match(result, /^~\d+s saved$/);
});

test("formatTimeSaved returns null when there's barely any gap", () => {
  assert.strictEqual(formatTimeSaved(words(10), words(9)), null);
});

test("formatTimeSaved returns null when the summary isn't shorter", () => {
  assert.strictEqual(formatTimeSaved(words(50), words(60)), null);
});

test("formatTimeSaved returns null for empty input", () => {
  assert.strictEqual(formatTimeSaved("", ""), null);
});
