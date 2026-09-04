import { UserFacingError } from "../util/userError.js";
import { MAX_PDF_TEXT_CHARS } from "./fileLimits.js";

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
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function extractPdfText(pdfBase64) {
  const {
    getDocument,
    InvalidPDFException,
    PasswordException,
    VerbosityLevel,
  } = await getPdfjs();

  const loadingTask = getDocument({
    data: base64ToBytes(pdfBase64),
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
    }
    return text;
  } finally {
    await loadingTask.destroy();
  }
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
