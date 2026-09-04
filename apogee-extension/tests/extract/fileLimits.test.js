import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_MB,
  assertUploadSizeOk,
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
