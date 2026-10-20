import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE64_SLICE_BYTES,
  MAX_BILIBILI_SUBTITLE_CHARS,
  MAX_BILIBILI_SUBTITLE_SEGMENTS,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_FINALIZE_TEXT_CHARS,
  MAX_PASTED_CHARS,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_MB,
  assertUploadOk,
  assertUploadSizeOk,
  assertUploadTypeOk,
  bytesToBase64,
  readTextHead,
  truncateWithNote,
  uploadExtension,
} from "../../lib/extract/fileLimits.js";

const supportedUploads = [
  ["report.pdf", "application/pdf"],
  [
    "report.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ["notes.txt", "text/plain"],
  ["notes.md", "text/markdown"],
  ["notes.md", "text/x-markdown"],
  ["notes.md", "text/plain"],
  ["data.json", "application/json"],
  ["data.json", "text/json"],
  ["data.json", "text/plain"],
  ["page.html", "text/html"],
  ["page.html", "text/plain"],
];

test("upload type gate accepts supported extensions and MIME types (#472)", () => {
  for (const [name, type] of supportedUploads) {
    assertUploadTypeOk({ name, type });
    assertUploadTypeOk({ name: name.toUpperCase(), type: type.toUpperCase() });
    assertUploadTypeOk({ name, type: `${type}; charset=utf-8` });
  }
});

test("upload type gate falls back to supported extensions for missing or generic MIME (#472)", () => {
  for (const [name] of supportedUploads) {
    assertUploadTypeOk({ name });
    assertUploadTypeOk({ name, type: "" });
    assertUploadTypeOk({ name, type: "application/octet-stream" });
  }
});

test("upload type gate rejects small unsupported binaries with a friendly message (#472)", () => {
  for (const [name, type] of [
    ["image.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["archive.zip", "application/zip"],
    ["program.exe", "application/octet-stream"],
    ["module.wasm", "application/wasm"],
    ["audio.mp3", "audio/mpeg"],
    ["video.mp4", "video/mp4"],
    ["legacy.doc", "application/msword"],
    ["unknown.bin", ""],
    ["notes.txt.exe", "text/plain"],
    ["unknown.bin", "text/plain"],
    ["README", "text/plain"],
    ["", "application/pdf"],
  ]) {
    const file = new File([new Uint8Array([0, 1, 2, 255])], name, { type });
    assertUploadSizeOk(file.size);
    assert.throws(
      () => assertUploadTypeOk(file),
      (err) => {
        assert.equal(err.isUserFacing, true);
        assert.match(err.message, /Unsupported file type/);
        assert.match(
          err.message,
          /PDF, DOCX, TXT, Markdown \(\.md\), JSON, or HTML/,
        );
        return true;
      },
      name,
    );
  }
});

test("upload type gate rejects incompatible MIME types despite a supported extension (#472)", () => {
  for (const [name] of supportedUploads) {
    assert.throws(() => assertUploadTypeOk({ name, type: "image/png" }));
  }
  assert.throws(() =>
    assertUploadTypeOk({ name: "report.txt", type: "application/pdf" }),
  );
  assert.throws(() =>
    assertUploadTypeOk({ name: "report.pdf", type: "text/plain" }),
  );
});

test("upload gate runs kind then size and returns the extension (#472)", () => {
  assert.equal(uploadExtension("NOTES.TXT"), ".txt");
  assert.equal(uploadExtension("README"), undefined);
  assert.equal(
    assertUploadOk({ name: "notes.txt", type: "text/plain", size: 4 }),
    ".txt",
  );
  assert.throws(
    () => assertUploadOk({ name: "image.png", type: "image/png", size: 4 }),
    /Unsupported file type/,
  );
  assert.throws(
    () =>
      assertUploadOk({
        name: "notes.txt",
        type: "text/plain",
        size: MAX_UPLOAD_FILE_BYTES + 1,
      }),
    /exceeds the 50 MB limit/,
  );
});

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

test("truncateWithNote passes short text through untouched (#211)", () => {
  assert.equal(MAX_PASTED_CHARS, 100 * 1024);
  const { text, truncated } = truncateWithNote(
    "  hello  ",
    MAX_PASTED_CHARS,
    "pasted",
  );
  assert.equal(text, "hello");
  assert.equal(truncated, false);
  const atCap = truncateWithNote(
    "x".repeat(MAX_PASTED_CHARS),
    MAX_PASTED_CHARS,
    "pasted",
  );
  assert.equal(atCap.truncated, false);
  assert.equal(atCap.text.length, MAX_PASTED_CHARS);
});

test("truncateWithNote truncates with a labeled note past the ceiling (#211, #267, #471)", () => {
  for (const [label, maxChars] of [
    ["pasted", MAX_PASTED_CHARS],
    ["selected", MAX_PASTED_CHARS],
    ["PDF file", MAX_EXTRACTED_TEXT_CHARS],
  ]) {
    const { text, truncated } = truncateWithNote(
      "y".repeat(maxChars + 1000),
      maxChars,
      label,
    );
    assert.equal(truncated, true);
    assert.ok(text.length <= maxChars);
    assert.ok(text.startsWith("y".repeat(100)));
    assert.match(
      text,
      new RegExp(
        `\\[\\.\\.\\.${label} content truncated to the first ${maxChars} characters\\.\\.\\.\\]$`,
      ),
    );
  }
});

test("truncateWithNote never splits an emoji at the cut point (#471)", () => {
  // The two offsets put the cut on either half of a surrogate pair, so one
  // of them always lands mid-emoji.
  for (const prefix of ["", "x"]) {
    const { text, truncated } = truncateWithNote(
      prefix + "😀".repeat(MAX_PASTED_CHARS),
      MAX_PASTED_CHARS,
      "selected",
    );
    assert.equal(truncated, true);
    const head = text.split("\n\n")[0].slice(prefix.length);
    for (const char of head) assert.equal(char, "😀");
  }
});

test("finished-summary backstop is a generous fixed ceiling", () => {
  assert.equal(MAX_FINALIZE_TEXT_CHARS, 1024 * 1024);
});

test("bilibili subtitle ceilings bound segments and characters", () => {
  assert.equal(MAX_BILIBILI_SUBTITLE_SEGMENTS, 5000);
  assert.equal(MAX_BILIBILI_SUBTITLE_CHARS, 500 * 1024);
});

test("extracted-text cap shares the pasted working ceiling (#267)", () => {
  assert.equal(MAX_EXTRACTED_TEXT_CHARS, MAX_PASTED_CHARS);
});

test("truncated extraction output fits back through the pasted choke point (#267)", () => {
  const { text } = truncateWithNote(
    "z".repeat(MAX_EXTRACTED_TEXT_CHARS + 5000),
    MAX_EXTRACTED_TEXT_CHARS,
    "DOCX file",
  );
  // summarizeCustomContent re-applies the same cap; the early cap must not
  // trigger a second truncation note downstream.
  const downstream = truncateWithNote(text, MAX_PASTED_CHARS, "pasted");
  assert.equal(downstream.truncated, false);
  assert.equal(downstream.text, text);
});

function pseudoRandomBytes(length, seed = 0x12345678) {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

test("bytesToBase64 slice size stays 3-byte aligned (#267)", () => {
  assert.equal(BASE64_SLICE_BYTES % 3, 0);
});

test("bytesToBase64 round-trips across slice boundaries (#267)", () => {
  for (const length of [
    0,
    1,
    2,
    3,
    5,
    0x8000,
    BASE64_SLICE_BYTES - 1,
    BASE64_SLICE_BYTES,
    BASE64_SLICE_BYTES + 1,
    BASE64_SLICE_BYTES * 2 + 7,
  ]) {
    const bytes = pseudoRandomBytes(length);
    const expected = Buffer.from(bytes).toString("base64");
    assert.equal(bytesToBase64(bytes), expected, `length ${length}`);
  }
});

test("bytesToBase64 handles a multi-slice large-file payload (#267)", () => {
  // ~200 KiB of adversarial bytes spans several slices without ever holding
  // a full-size binary string next to the output.
  const bytes = pseudoRandomBytes(BASE64_SLICE_BYTES * 5 + 12345);
  const decoded = Buffer.from(bytesToBase64(bytes), "base64");
  assert.deepEqual(new Uint8Array(decoded), bytes);
});

test("readTextHead reads small files whole without truncating (#267)", async () => {
  const file = new Blob(["  hello world  "]);
  const { text, truncated } = await readTextHead(file);
  assert.equal(truncated, false);
  assert.equal(text, "hello world");
});

test("readTextHead caps a large file with a user-visible note (#267)", async () => {
  // Oversized upload: only the head may materialize, never the whole string.
  const file = new Blob(["a".repeat(MAX_PASTED_CHARS + 50_000)]);
  const { text, truncated } = await readTextHead(file);
  assert.equal(truncated, true);
  assert.ok(text.length <= MAX_PASTED_CHARS);
  assert.match(text, /\[\.\.\.file content truncated/);
  assert.equal(
    truncateWithNote(text, MAX_PASTED_CHARS, "pasted").truncated,
    false,
  );
});

test("readTextHead counts characters, not bytes, for multibyte text (#267)", async () => {
  // "é" costs 2 bytes in UTF-8: byte size exceeds the cap while the
  // character count sits exactly on it, so nothing is truncated.
  const file = new Blob(["é".repeat(MAX_PASTED_CHARS)]);
  assert.ok(file.size > MAX_PASTED_CHARS);
  const { text, truncated } = await readTextHead(file);
  assert.equal(truncated, false);
  assert.equal(text.length, MAX_PASTED_CHARS);
});

test("readTextHead never splits surrogate pairs at the cap (#267)", async () => {
  const file = new Blob(["😀".repeat(MAX_PASTED_CHARS)]);
  const { text, truncated } = await readTextHead(file, 100);
  assert.equal(truncated, true);
  assert.match(text, /\[\.\.\.file content truncated/);
  const head = text.split("\n\n")[0];
  // Every code point survived whole: no split surrogate or replacement char.
  for (const char of head) {
    assert.equal(char.length, 2);
    assert.notEqual(char, "�");
  }
});

test("readTextHead streams when file size is unknown (#267)", async () => {
  const blob = new Blob(["q".repeat(5000)]);
  const unknownSize = {
    stream: () => blob.stream(),
  };
  const { text, truncated } = await readTextHead(unknownSize, 100);
  assert.equal(truncated, true);
  assert.match(
    text,
    /\[\.\.\.file content truncated to the first 100 characters/,
  );
  const small = { stream: () => new Blob(["ok"]).stream() };
  assert.deepEqual(await readTextHead(small, 100), {
    text: "ok",
    truncated: false,
  });
});
