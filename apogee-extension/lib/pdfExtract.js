// PDF text extraction, runs inside the service worker (see
// background/service-worker.js's "extract-pdf" action). Ported from
// apogee-backend/src/services/pdfService.js, but uses pdfjs-dist's browser
// build (pdf.mjs) instead of the legacy Node build, since there's no Node
// process here.
//
// Dynamic-imported, mirrors offscreen.js's getWebLLM(): a heavy module load
// shouldn't block message-handler registration.

export class PdfExtractionError extends Error {}

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

/** Extract all text from a PDF given as an ArrayBuffer. */
export async function extractPdfText(arrayBuffer) {
  const {
    getDocument,
    InvalidPDFException,
    PasswordException,
    VerbosityLevel,
  } = await getPdfjs();

  const loadingTask = getDocument({
    data: new Uint8Array(arrayBuffer),
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
      // each item's hasEOL flag so line breaks match the PDF's layout.
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
