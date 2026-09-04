import test from "node:test";
import assert from "node:assert/strict";

import { appendPdfText } from "../../lib/extract/pdfExtract.js";
import { MAX_PDF_TEXT_CHARS } from "../../lib/extract/fileLimits.js";

test("appendPdfText accumulates page text under the ceiling", () => {
  assert.equal(appendPdfText("", "Hello "), "Hello ");
  assert.equal(appendPdfText("Hello ", "world.\n"), "Hello world.\n");
});

test("appendPdfText rejects accumulation past the text ceiling (#184)", () => {
  const almost = "x".repeat(MAX_PDF_TEXT_CHARS - 10);
  assert.equal(appendPdfText(almost, "12345").length, MAX_PDF_TEXT_CHARS - 5);
  assert.throws(
    () => appendPdfText(almost, "12345678901"),
    (err) => {
      assert.equal(err.isUserFacing, true);
      assert.match(err.message, /too much text/i);
      return true;
    },
  );
});
