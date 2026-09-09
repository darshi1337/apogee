import { UserFacingError } from "../util/userError.js";

// Single source of truth for user-supplied file ceilings, matching the
// tab-PDF ceiling enforced in pageExtraction.js. Extension messaging and the
// base64 + binary copies in the popup path balloon past this point, so every
// file entry point (select, drop, tab PDF) checks against the same number.
export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_FILE_MB = 50;

export function assertUploadSizeOk(byteLength, label = "file") {
  if (typeof byteLength === "number" && byteLength > MAX_UPLOAD_FILE_BYTES) {
    throw new UserFacingError(
      `This ${label} is ${Math.round(byteLength / 1024 / 1024)} MB, ` +
        `which exceeds the ${MAX_UPLOAD_FILE_MB} MB limit for in-extension processing.`,
    );
  }
}

// DOCX hardening. Only word/document.xml is ever inflated, so a swarm of
// entries is not the vector - a single deflate bomb is. Cap its expansion
// two ways: relative to its own compressed size (a legitimate document.xml
// compresses roughly 5-15x; 100x is generous headroom) and absolutely.
export const MAX_DOCX_EXPANSION_RATIO = 100;
export const MAX_DOCX_XML_BYTES = 100 * 1024 * 1024;

// Central-directory entry count bound. Legitimate documents carry tens of
// parts; anything past this is malformed or hostile, and it keeps the parse
// loop proportional to the (already size-checked) input.
export const MAX_DOCX_ENTRIES = 10000;

// PDF text accumulation backstop. Input bytes are already capped above; this
// bounds pathological content-stream inflation inside the parser before the
// result string itself becomes the OOM vector.
export const MAX_PDF_TEXT_CHARS = 25 * 1024 * 1024;

// Finished-summary backstop (#211 follow-up). stream-finished text arrives
// via extension messaging and is written to cache/history, so bound it
// before it fans out: real summaries are kilobytes, 1 MB is generous.
export const MAX_FINALIZE_TEXT_CHARS = 1024 * 1024;

// Bilibili subtitle hardening. Track JSON comes from the hdslb CDN and each
// entry is mapped into a segment, so a malformed track with millions of
// entries (or megabyte bodies) would turn the service worker into an OOM
// vector. Real tracks are hundreds of segments and tens of KB; both ceilings
// are generous headroom, mirroring the PDF/DOCX accumulation backstops above.
export const MAX_BILIBILI_SUBTITLE_SEGMENTS = 5000;
export const MAX_BILIBILI_SUBTITLE_CHARS = 500 * 1024;

// Pasted-text and plain-text file ceiling (#211). file.size bounds the upload
// (~50 MB string), but two post-read text paths were unbounded: file.text()
// for txt/md/json/html and the pasted-text dialog. A multi-MB string here
// becomes thousands of prompt chunks (slow prompt / local OOM), so truncate
// early with a note, mirroring truncateForPrompt's convention.
export const MAX_PASTED_CHARS = 100 * 1024;

export function truncatePastedText(text) {
  const clean = (text || "").trim();
  if (clean.length <= MAX_PASTED_CHARS)
    return { text: clean, truncated: false };
  return {
    text:
      `${clean.slice(0, MAX_PASTED_CHARS).trim()}\n\n` +
      `[...pasted content truncated to the first ${MAX_PASTED_CHARS} characters...]`,
    truncated: true,
  };
}
