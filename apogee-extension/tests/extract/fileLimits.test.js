import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE64_SLICE_BYTES,
  MAX_BILIBILI_SUBTITLE_CHARS,
  MAX_BILIBILI_SUBTITLE_SEGMENTS,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_FINALIZE_TEXT_CHARS,
  MAX_PASTED_CHARS,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_MB,
  assertUploadSizeOk,
  bytesToBase64,
  readTextHead,
  truncateExtractedText,
  truncatePastedText,
} from "../../lib/extract/fileLimits.js";

test("upload ceiling matches the documented 50 MB tab-PDF limit", () => {
  assert.equal(MAX_UPLOAD_FILE_BYTES, 50 * 1024 * 1024);
  assert.equal(MAX_UPLOAD_FILE_MB, 50);
});

test("assertUploadSizeOk passes files at or under the ceiling", () => {
  assertUploadSizeOk(0, "PDF");
  assertUploadSizeOk(MAX_UPLOAD_FILE_BYTES, "PDF");
  assertUploadSizeOk(undefined, "file");
});

test("assertUploadSizeOk rejects oversized files with a friendly message (#184)", () => {
  assert.throws(
    () => assertUploadSizeOk(75 * 1024 * 1024, "PDF"),
    (err) => {
      assert.equal(err.isUserFacing, true);
      assert.match(err.message, /75 MB/);
      assert.match(err.message, /exceeds the 50 MB limit/);
      return true;
    },
  );
});

test("truncatePastedText passes short text through untouched (#211)", () => {
  assert.equal(MAX_PASTED_CHARS, 100 * 1024);
  const { text, truncated } = truncatePastedText("  hello  ");
  assert.equal(text, "hello");
  assert.equal(truncated, false);
  const atCap = truncatePastedText("x".repeat(MAX_PASTED_CHARS));
  assert.equal(atCap.truncated, false);
  assert.equal(atCap.text.length, MAX_PASTED_CHARS);
});

test("truncatePastedText truncates with a note past the ceiling (#211)", () => {
  const { text, truncated } = truncatePastedText(
    "y".repeat(MAX_PASTED_CHARS + 1000),
  );
  assert.equal(truncated, true);
  assert.ok(text.length < MAX_PASTED_CHARS + 1000);
  assert.match(text, /\[\.\.\.pasted content truncated/);
});

test("finished-summary backstop is a generous fixed ceiling", () => {
  assert.equal(MAX_FINALIZE_TEXT_CHARS, 1024 * 1024);
});

test("bilibili subtitle ceilings bound segments and characters", () => {
  assert.equal(MAX_BILIBILI_SUBTITLE_SEGMENTS, 5000);
  assert.equal(MAX_BILIBILI_SUBTITLE_CHARS, 500 * 1024);
});

test("extracted-text cap shares the pasted working ceiling (#267)", () => {
  assert.equal(MAX_EXTRACTED_TEXT_CHARS, MAX_PASTED_CHARS);
});

test("truncateExtractedText passes short text through untouched (#267)", () => {
  const { text, truncated } = truncateExtractedText("  hello  ", "PDF");
  assert.equal(text, "hello");
  assert.equal(truncated, false);
  const atCap = truncateExtractedText(
    "x".repeat(MAX_EXTRACTED_TEXT_CHARS),
    "PDF",
  );
  assert.equal(atCap.truncated, false);
  assert.equal(atCap.text.length, MAX_EXTRACTED_TEXT_CHARS);
});

test("truncateExtractedText truncates with a file note past the ceiling (#267)", () => {
  const { text, truncated } = truncateExtractedText(
    "y".repeat(MAX_EXTRACTED_TEXT_CHARS + 1000),
    "PDF",
  );
  assert.equal(truncated, true);
  assert.ok(text.startsWith("y".repeat(100)));
  assert.match(text, /\[\.\.\.PDF content truncated/);
  assert.match(text, new RegExp(`${MAX_EXTRACTED_TEXT_CHARS}`));
});

test("truncated extraction output fits back through the pasted choke point (#267)", () => {
  const { text } = truncateExtractedText(
    "z".repeat(MAX_EXTRACTED_TEXT_CHARS + 5000),
    "DOCX file",
  );
  // summarizeCustomContent re-applies truncatePastedText; the early cap must
  // not trigger a second truncation note downstream.
  const downstream = truncatePastedText(text);
  assert.equal(downstream.truncated, false);
  assert.equal(downstream.text, text);
});

function pseudoRandomBytes(length, seed = 0x12345678) {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

test("bytesToBase64 slice size stays 3-byte aligned (#267)", () => {
  assert.equal(BASE64_SLICE_BYTES % 3, 0);
});

test("bytesToBase64 round-trips across slice boundaries (#267)", () => {
  for (const length of [
    0,
    1,
    2,
    3,
    5,
    0x8000,
    BASE64_SLICE_BYTES - 1,
    BASE64_SLICE_BYTES,
    BASE64_SLICE_BYTES + 1,
    BASE64_SLICE_BYTES * 2 + 7,
  ]) {
    const bytes = pseudoRandomBytes(length);
    const expected = Buffer.from(bytes).toString("base64");
    assert.equal(bytesToBase64(bytes), expected, `length ${length}`);
  }
});

test("bytesToBase64 handles a multi-slice large-file payload (#267)", () => {
  // ~200 KiB of adversarial bytes spans several slices without ever holding
  // a full-size binary string next to the output.
  const bytes = pseudoRandomBytes(BASE64_SLICE_BYTES * 5 + 12345);
  const decoded = Buffer.from(bytesToBase64(bytes), "base64");
  assert.deepEqual(new Uint8Array(decoded), bytes);
});

test("readTextHead reads small files whole without truncating (#267)", async () => {
  const file = new Blob(["  hello world  "]);
  const { text, truncated } = await readTextHead(file);
  assert.equal(truncated, false);
  assert.equal(text, "hello world");
});

test("readTextHead caps a large file with a user-visible note (#267)", async () => {
  // Oversized upload: only the head may materialize, never the whole string.
  const file = new Blob(["a".repeat(MAX_PASTED_CHARS + 50_000)]);
  const { text, truncated } = await readTextHead(file);
  assert.equal(truncated, true);
  assert.ok(text.length <= MAX_PASTED_CHARS);
  assert.match(text, /\[\.\.\.file content truncated/);
  assert.equal(truncatePastedText(text).truncated, false);
});

test("readTextHead counts characters, not bytes, for multibyte text (#267)", async () => {
  // "é" costs 2 bytes in UTF-8: byte size exceeds the cap while the
  // character count sits exactly on it, so nothing is truncated.
  const file = new Blob(["é".repeat(MAX_PASTED_CHARS)]);
  assert.ok(file.size > MAX_PASTED_CHARS);
  const { text, truncated } = await readTextHead(file);
  assert.equal(truncated, false);
  assert.equal(text.length, MAX_PASTED_CHARS);
});

test("readTextHead never splits surrogate pairs at the cap (#267)", async () => {
  const file = new Blob(["😀".repeat(MAX_PASTED_CHARS)]);
  const { text, truncated } = await readTextHead(file, 100);
  assert.equal(truncated, true);
  assert.match(text, /\[\.\.\.file content truncated/);
  const head = text.split("\n\n")[0];
  // Every code point survived whole: no split surrogate or replacement char.
  for (const char of head) {
    assert.equal(char.length, 2);
    assert.notEqual(char, "�");
  }
});

test("readTextHead streams when file size is unknown (#267)", async () => {
  const blob = new Blob(["q".repeat(5000)]);
  const unknownSize = {
    stream: () => blob.stream(),
  };
  const { text, truncated } = await readTextHead(unknownSize, 100);
  assert.equal(truncated, true);
  assert.match(
    text,
    /\[\.\.\.file content truncated to the first 100 characters/,
  );
  const small = { stream: () => new Blob(["ok"]).stream() };
  assert.deepEqual(await readTextHead(small, 100), {
    text: "ok",
    truncated: false,
  });
});
