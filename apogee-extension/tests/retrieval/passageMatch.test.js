import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { findMatchingRange } from "../../lib/retrieval/passageMatch.js";

// The matcher below is duplicated into content/highlight.js, which is injected as a plain script and cannot import it. Without this guard the tests would happily pass while the code that actually highlights passages drifts away from the code being tested.
function sharedBlock(path) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  const start = src.indexOf("function escapeRegExp");
  const end = src.indexOf("// END SHARED");
  assert.ok(
    start !== -1 && end > start,
    `${path} is missing the shared matcher markers`,
  );
  return src
    .slice(start, end)
    .replace(/^export /gm, "")
    .trimEnd();
}

test("the matcher in content/highlight.js is identical to the one under test", () => {
  assert.strictEqual(
    sharedBlock("../../content/highlight.js"),
    sharedBlock("../../lib/retrieval/passageMatch.js"),
    "content/highlight.js and lib/retrieval/passageMatch.js have drifted apart. " +
      "The content script is the copy that runs; edit both, or these tests stop " +
      "saying anything about the shipped highlighter.",
  );
});

test("findMatchingRange finds an exact match", () => {
  const page =
    "Some intro text. The quick brown fox jumps over the lazy dog. More text.";
  const result = findMatchingRange(
    page,
    "The quick brown fox jumps over the lazy dog.",
  );
  assert.ok(result);
  assert.strictEqual(
    page.slice(result.start, result.end),
    "The quick brown fox jumps over the lazy dog.",
  );
});

test("findMatchingRange tolerates whitespace differences (Readability-collapsed vs live DOM)", () => {
  const page =
    "Intro.\n\n  The   quick brown\nfox jumps over   the lazy dog.  \n\nOutro.";
  const chunk = "The quick brown fox jumps over the lazy dog.";
  const result = findMatchingRange(page, chunk);
  assert.ok(result);
  const matched = page.slice(result.start, result.end);
  assert.strictEqual(matched.replace(/\s+/g, " "), chunk);
});

test("findMatchingRange is case-insensitive", () => {
  const page = "Some text. THE QUICK BROWN FOX jumps. More text.";
  const result = findMatchingRange(page, "the quick brown fox jumps");
  assert.ok(result);
  assert.strictEqual(
    page.slice(result.start, result.end),
    "THE QUICK BROWN FOX jumps",
  );
});

test("findMatchingRange falls back to a shorter window when the full chunk isn't found", () => {
  const sharedPrefix =
    "The quick brown fox jumps over the lazy dog while wandering through a meadow full of wildflowers and tall grass beneath a clear blue sky on a warm summer afternoon, listening to birds";
  assert.ok(
    sharedPrefix.length >= 180,
    "test fixture must exceed the prefix window",
  );
  const page = `Intro. ${sharedPrefix} but then the page continues with completely different unrelated content. Outro.`;
  const chunk = `${sharedPrefix} but the chunk's own account of what happened next is entirely different and doesn't appear anywhere on this page at all.`;
  const result = findMatchingRange(page, chunk);
  assert.ok(result);
  assert.ok(
    page.slice(result.start, result.end).startsWith("The quick brown fox"),
  );
});

test("findMatchingRange returns null when nothing matches anywhere", () => {
  const page =
    "This page is about gardening tips and vegetable planting schedules.";
  const chunk = "Quantum entanglement enables faster-than-light communication.";
  assert.strictEqual(findMatchingRange(page, chunk), null);
});

test("findMatchingRange returns null for empty inputs", () => {
  assert.strictEqual(findMatchingRange("", "something"), null);
  assert.strictEqual(findMatchingRange("some page text", ""), null);
  assert.strictEqual(findMatchingRange("", ""), null);
});

test("findMatchingRange caps an oversized needle: skips the full match, falls back to a sentence", () => {
  const target = "This exact sentence appears verbatim on the page.";
  const page = `Lead-in text. ${target} Trailing text.`;
  const oversizedNeedle = "Filler sentence number one. ".repeat(100) + target;
  const result = findMatchingRange(page, oversizedNeedle);
  assert.ok(result, "should still find the embedded sentence");
  assert.strictEqual(page.slice(result.start, result.end), target);
});
