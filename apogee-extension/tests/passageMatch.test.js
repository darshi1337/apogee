import test from "node:test";
import assert from "node:assert";
import { findMatchingRange } from "../lib/passageMatch.js";

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
  // Readability's extraction collapsed the whitespace down to single spaces.
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
  // findMatchingRange's prefix tier tries the chunk's own first
  // PREFIX_WINDOW_CHARS (180) characters as one fixed window, it isn't a
  // general "find any matching substring" search, so this test needs the
  // page and chunk to genuinely share their first 180+ characters and only
  // diverge after that point for the prefix tier (as opposed to the
  // full-chunk or per-sentence tiers, both of which this is deliberately
  // structured to fail) to be what actually succeeds.
  const sharedPrefix =
    "The quick brown fox jumps over the lazy dog while wandering through a meadow full of wildflowers and tall grass beneath a clear blue sky on a warm summer afternoon, listening to birds";
  assert.ok(
    sharedPrefix.length >= 180,
    "test fixture must exceed the prefix window",
  );
  const page = `Intro. ${sharedPrefix} but then the page continues with completely different unrelated content. Outro.`;
  // One long run-on sentence (no period until the very end), so the
  // per-sentence tier sees only one span, identical to the full chunk, and
  // fails the same way.
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
