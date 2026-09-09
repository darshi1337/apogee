import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BILIBILI_SUBTITLE_CHARS,
  MAX_BILIBILI_SUBTITLE_SEGMENTS,
  MAX_FINALIZE_TEXT_CHARS,
  MAX_PASTED_CHARS,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_MB,
  assertUploadSizeOk,
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
