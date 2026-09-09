import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { findMatchingRange } from "../../lib/retrieval/passageMatch.js";

// content/highlight.js is bundled by Vite and imports the matcher below, so
// there is one implementation. This guard fails if someone reintroduces a
// duplicated matcher into the content script instead of importing it.
test("content/highlight.js imports the canonical matcher instead of duplicating it", () => {
  const highlightSrc = readFileSync(
    new URL("../../content/highlight.js", import.meta.url),
    "utf8",
  );
  assert.match(
    highlightSrc,
    /from\s+["']\.\.\/lib\/retrieval\/passageMatch\.js["']/,
    "content/highlight.js must import findMatchingRange from lib/retrieval/passageMatch.js",
  );
  for (const duplicated of [
    "function escapeRegExp",
    "function buildFlexibleMatcher",
    "function tryMatch",
    "function splitIntoSpans",
    "PREFIX_WINDOW_CHARS",
    "MAX_MATCH_TEXT_CHARS",
  ]) {
    assert.ok(
      !highlightSrc.includes(duplicated),
      `content/highlight.js must not duplicate the matcher (${duplicated} found); import it instead.`,
    );
  }
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
