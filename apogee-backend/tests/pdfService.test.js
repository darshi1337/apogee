import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";

import { extractPdfText, PdfExtractionError } from "../src/services/pdfService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("extractPdfText extracts text from a valid PDF", async () => {
  const fixture = path.join(__dirname, "fixtures", "sample.pdf");
  const text = await extractPdfText(fixture);
  assert.ok(text.includes("Hello Apogee"));
});

test("extractPdfText throws PdfExtractionError for a non-PDF file", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "apogee-pdf-service-test-"));
  const badFile = path.join(tmpDir, "not-a-pdf.pdf");
  writeFileSync(badFile, "this is not a pdf");

  try {
    await assert.rejects(
      () => extractPdfText(badFile),
      (err) => err instanceof PdfExtractionError,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
