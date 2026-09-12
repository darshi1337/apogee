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

// Expanded-text working ceiling (#267). PDF/DOCX extraction inflates a 50 MB
// upload into megabytes of text; the popup cannot hold the full expansion
// plus prompt chunks, and summarizeCustomContent truncates to MAX_PASTED_CHARS
// downstream anyway. Capping at the same size at the extraction site bounds
// peak memory and keeps one user-visible truncation note instead of two.
// The truncated output is sized to fit back through truncatePastedText
// untouched (room is reserved for the note), so the choke point stays quiet.
export const MAX_EXTRACTED_TEXT_CHARS = MAX_PASTED_CHARS;

// Cut a string without leaving a dangling lead surrogate at the boundary,
// so truncating emoji-heavy text never emits a broken character.
function sliceOnCharBoundary(text, maxLength) {
  let head = text.slice(0, Math.max(0, maxLength));
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return head;
}

export function truncateExtractedText(text, label = "file") {
  const clean = (text || "").trim();
  if (clean.length <= MAX_EXTRACTED_TEXT_CHARS)
    return { text: clean, truncated: false };
  const note =
    `[...${label} content truncated to the first ` +
    `${MAX_EXTRACTED_TEXT_CHARS} characters...]`;
  const head = sliceOnCharBoundary(
    clean,
    MAX_EXTRACTED_TEXT_CHARS - note.length - 2,
  ).trimEnd();
  return { text: `${head}\n\n${note}`, truncated: true };
}

// SW/offscreen ingress hardening (#269). summarize/ask/retrieve-context
// payloads cross extension messaging unbounded today; only the UI-side
// pasted cap and the 1 MB finalize backstop bound them, while stream.text
// accumulates pre-cap and the map-every-chunk path turns a giant hostile
// page into many sequential model calls. Content past this ceiling is
// rejected with a UserFacingError at the trust boundary; title/url/question
// reuse the prompt-fencing ceilings so one set of numbers guards both.
export const MAX_INGRESS_CONTENT_CHARS = MAX_FINALIZE_TEXT_CHARS;
export const MAX_INGRESS_TITLE_CHARS = 500;
export const MAX_INGRESS_URL_CHARS = 2000;
export const MAX_INGRESS_QUESTION_CHARS = 2000;
export const MAX_INGRESS_PROMPT_CHARS = MAX_FINALIZE_TEXT_CHARS;

// Absolute map-stage ceiling (#269). getMaxChunks bounds the reduce budget
// per model, but the no-selector fallback keeps every chunk, so a 1 MB
// hostile page is still dozens of sequential model calls. Capping mapped
// chunks bounds total calls regardless of ingress size.
export const MAX_ABSOLUTE_MAP_CHUNKS = 64;

// Live stream-text ceiling (#269). finalizeSummaryJob caps at write time,
// but stream.text grows with every token before that. Stop accumulating
// past the same 1 MB so a runaway model cannot bloat SW/offscreen memory.
export const MAX_STREAM_TEXT_CHARS = MAX_FINALIZE_TEXT_CHARS;

function ingressLength(value) {
  return typeof value === "string" ? value.length : 0;
}

export function assertIngressPayloadOk(payload = {}) {
  const { content, question, query, title, url, summary, prompt } = payload;
  const checks = [
    [content, MAX_INGRESS_CONTENT_CHARS, "content"],
    [question, MAX_INGRESS_QUESTION_CHARS, "question"],
    [query, MAX_INGRESS_QUESTION_CHARS, "question"],
    [title, MAX_INGRESS_TITLE_CHARS, "title"],
    [url, MAX_INGRESS_URL_CHARS, "URL"],
    [summary, MAX_INGRESS_CONTENT_CHARS, "summary"],
    [prompt, MAX_INGRESS_PROMPT_CHARS, "prompt"],
  ];
  for (const [value, max, label] of checks) {
    if (ingressLength(value) > max) {
      throw new UserFacingError(
        `This ${label} exceeds the ${max.toLocaleString()} character limit for in-extension processing. Try a shorter document.`,
      );
    }
  }
}

export function appendStreamTextCapped(current, addition) {
  const text = `${current || ""}${addition || ""}`;
  if (text.length <= MAX_STREAM_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_STREAM_TEXT_CHARS), truncated: true };
}

// Slice size for incremental base64 encoding below. Must stay a multiple of 3
// so each slice encodes to a whole number of base64 quanta and slices can be
// encoded independently without corrupting boundary bytes.
export const BASE64_SLICE_BYTES = 0x9000;

/**
 * Encode bytes to base64 one slice at a time (#267). The naive
 * binary-string-then-btoa pattern holds the input bytes, a full-size binary
 * string, and the full base64 output concurrently (~3x a 50 MB upload in
 * UTF-16 strings). Here only the input, the growing output, and one 36 KiB
 * slice are live at once; each slice's binary string is released per
 * iteration.
 */
export function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += BASE64_SLICE_BYTES) {
    const slice = bytes.subarray(i, i + BASE64_SLICE_BYTES);
    let binary = "";
    const STEP = 0x8000;
    for (let j = 0; j < slice.length; j += STEP) {
      binary += String.fromCharCode.apply(null, slice.subarray(j, j + STEP));
    }
    out += btoa(binary);
  }
  return out;
}

/**
 * Read at most maxChars+1 characters of a user-supplied file (#267).
 * file.text() on a 50 MB upload materializes the whole string before the
 * caller can truncate it; streaming slices through a TextDecoder and
 * cancelling past the cap keeps peak memory proportional to the cap, not the
 * file. Returns { text, truncated } with the same note convention as
 * truncatePastedText. UTF-8 note: every character costs >= 1 byte, so a file
 * whose byte size fits the cap cannot exceed it and is read whole.
 */
export async function readTextHead(file, maxChars = MAX_PASTED_CHARS) {
  if (
    typeof file.size === "number" &&
    file.size <= maxChars &&
    typeof file.text === "function"
  ) {
    return truncatePastedText(await file.text());
  }
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let text = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > maxChars) {
        truncated = true;
        try {
          await reader.cancel();
        } catch {}
        break;
      }
    }
    if (!truncated) text += decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  if (!truncated) return truncatePastedText(text);
  const clean = text.trim();
  const note = `[...file content truncated to the first ${maxChars} characters...]`;
  const head = sliceOnCharBoundary(clean, maxChars - note.length - 2).trimEnd();
  return { text: `${head}\n\n${note}`, truncated: true };
}
