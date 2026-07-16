import { readFile } from "node:fs/promises";
import {
  getDocument,
  InvalidPDFException,
  PasswordException,
  VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";

export class PdfExtractionError extends Error {}

/** Extract all text from a PDF file. */
export async function extractPdfText(pdfPath) {
  const data = new Uint8Array(await readFile(pdfPath));

  // getDocument() returns a loading task, not the document itself, the
  // task (not the resolved PDFDocumentProxy) is what exposes destroy().
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    if (err instanceof InvalidPDFException) {
      throw new PdfExtractionError("the file is not a valid PDF");
    }
    if (err instanceof PasswordException) {
      throw new PdfExtractionError("the PDF is password-protected");
    }
    throw new PdfExtractionError(err.message ?? String(err));
  }

  try {
    let text = "";
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      // Text items are runs, not lines, join runs with a space and honor
      // each item's hasEOL flag so line breaks match the PDF's layout
      // (closest match to PyMuPDF's default line-preserving text output).
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      text += "\n";
    }
    return text;
  } finally {
    await loadingTask.destroy();
  }
}
