import { UserFacingError } from "../util/userError.js";
import { MAX_PDF_TEXT_CHARS, truncateExtractedText } from "./fileLimits.js";

class PdfExtractionError extends UserFacingError {}

let _pdfjs = null;

async function getPdfjs() {
  if (!_pdfjs) {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc =
      chrome.runtime.getURL("pdf.worker.js");
    _pdfjs = pdfjs;
  }
  return _pdfjs;
}

function base64ToBytes(base64) {
  let binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Intentional release: drop the transient string before the heavy parse.
  // eslint-disable-next-line no-useless-assignment
  binary = null;
  return bytes;
}

/**
 * Parse PDF text straight from bytes (#267). The popup upload path used to
 * hold arrayBuffer + binary string + base64 concurrently and then decode the
 * base64 back to bytes inside pdf.js — ~3x the file in memory. Callers that
 * already have bytes use this and skip both transient strings entirely.
 *
 * options.maxChars bounds the *expanded* text: once a page pushes past it,
 * parsing stops early (remaining pages are never read) and the result carries
 * the user-visible truncation note. The MAX_PDF_TEXT_CHARS backstop still
 * throws on pathological inflation. Defaults preserve the legacy behavior
 * (service-worker tab path), which caps only via the backstop.
 */
export async function extractPdfTextFromBytes(
  bytes,
  { maxChars = Infinity, label = "PDF" } = {},
) {
  const {
    getDocument,
    InvalidPDFException,
    PasswordException,
    VerbosityLevel,
  } = await getPdfjs();

  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    if (err instanceof InvalidPDFException) {
      throw new PdfExtractionError("This file is not a valid PDF.");
    }
    if (err instanceof PasswordException) {
      throw new PdfExtractionError("This PDF is password-protected.");
    }
    throw new PdfExtractionError(err.message ?? String(err));
  }

  try {
    let text = "";
    let truncated = false;
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      let addition = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        addition += item.str + (item.hasEOL ? "\n" : " ");
      }
      addition += "\n";
      text = appendPdfText(text, addition);
      if (text.length > maxChars) {
        text = truncateExtractedText(text, label).text;
        truncated = true;
        break;
      }
    }
    return { text, truncated };
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractPdfText(pdfBase64) {
  const { text } = await extractPdfTextFromBytes(base64ToBytes(pdfBase64));
  return text;
}

/**
 * Append one page's text to the running extraction, enforcing the text
 * accumulation ceiling so pathological content-stream inflation inside the
 * parser cannot turn the result string itself into the OOM vector.
 */
export function appendPdfText(text, addition) {
  const next = text + addition;
  if (next.length > MAX_PDF_TEXT_CHARS) {
    throw new PdfExtractionError(
      "This PDF contains too much text to process in the extension. " +
        "Try a shorter document.",
    );
  }
  return next;
}
