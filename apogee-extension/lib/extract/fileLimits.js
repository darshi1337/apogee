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
