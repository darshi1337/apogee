import test from "node:test";
import assert from "node:assert";
import { UserFacingError, toUserMessage } from "../../lib/util/userError.js";

// ── UserFacingError instances pass through verbatim ─────────────────────

test("toUserMessage returns message verbatim for UserFacingError", () => {
  const err = new UserFacingError("This PDF is password-protected.");
  assert.strictEqual(toUserMessage(err), "This PDF is password-protected.");
});

test("toUserMessage returns message verbatim for subclass with isUserFacing", () => {
  class CustomError extends UserFacingError {}
  const err = new CustomError("Custom user message.");
  assert.strictEqual(toUserMessage(err), "Custom user message.");
});

test("toUserMessage returns message verbatim for duck-typed isUserFacing", () => {
  const err = new Error("Duck-typed user message.");
  err.isUserFacing = true;
  assert.strictEqual(toUserMessage(err), "Duck-typed user message.");
});

// ── Raw errors are mapped to fallbacks ──────────────────────────────────

test("toUserMessage maps raw PDF errors to a PDF fallback", () => {
  const err = new Error("pdf.js: Invalid PDF structure at offset 12345");
  assert.strictEqual(toUserMessage(err), "Couldn't process this PDF document.");
});

test("toUserMessage maps raw WebGPU errors to the in-browser fallback", () => {
  const err = new Error("WebGPU device was lost");
  assert.strictEqual(
    toUserMessage(err),
    "In-browser model error. Try picking a different model in Settings.",
  );
});

test("toUserMessage maps raw ONNX errors to the in-browser fallback", () => {
  const err = new Error("ONNX Runtime: failed to load model");
  assert.strictEqual(
    toUserMessage(err),
    "In-browser model error. Try picking a different model in Settings.",
  );
});

test("toUserMessage maps raw OOM/memory errors to the memory limit fallback", () => {
  const err = new Error("Transformers.js: out of memory");
  assert.strictEqual(
    toUserMessage(err),
    "Memory limit reached while processing this document. Try a smaller model or reducing context size.",
  );
});

test("toUserMessage maps raw Transformers.js errors to the in-browser fallback", () => {
  const err = new Error("Transformers.js: failed to load module");
  assert.strictEqual(
    toUserMessage(err),
    "In-browser model error. Try picking a different model in Settings.",
  );
});

test("toUserMessage maps raw offscreen errors to the in-browser fallback", () => {
  const err = new Error("offscreen document was closed unexpectedly");
  assert.strictEqual(
    toUserMessage(err),
    "In-browser model error. Try picking a different model in Settings.",
  );
});

test("toUserMessage maps raw Ollama connection errors to the Ollama fallback", () => {
  const err = new TypeError("Failed to fetch (Ollama)");
  assert.strictEqual(
    toUserMessage(err),
    "Could not connect to Ollama. Make sure Ollama is running and check your Settings.",
  );
});

test("toUserMessage maps 'could not connect' errors to the Ollama fallback", () => {
  const err = new Error("could not connect to remote host");
  assert.strictEqual(
    toUserMessage(err),
    "Could not connect to Ollama. Make sure Ollama is running and check your Settings.",
  );
});

test("toUserMessage maps stream/connection-lost errors to the stream fallback", () => {
  const err = new Error("connection was lost mid-generation");
  assert.strictEqual(
    toUserMessage(err),
    "Connection to the model was lost. Try summarizing again.",
  );
});

test("toUserMessage maps port closed errors to the stream fallback", () => {
  const err = new Error("message port closed before response");
  assert.strictEqual(
    toUserMessage(err),
    "Connection to the model was lost. Try summarizing again.",
  );
});

test("toUserMessage maps content script injection errors to the page fallback", () => {
  const err = new Error("Cannot inject content script into this page");
  assert.strictEqual(
    toUserMessage(err),
    "Couldn't read this page. Try reloading it.",
  );
});

test("toUserMessage maps page extraction errors to the page fallback", () => {
  const err = new Error("Failed to extract content from page");
  assert.strictEqual(
    toUserMessage(err),
    "Couldn't read this page. Try reloading it.",
  );
});

// ── Generic fallback ────────────────────────────────────────────────────

test("toUserMessage uses generic fallback for unrecognized errors", () => {
  const err = new Error("foobar baz 42");
  assert.strictEqual(
    toUserMessage(err),
    "An unexpected error occurred. Try summarizing again.",
  );
});

test("toUserMessage uses generic fallback for a bare string", () => {
  assert.strictEqual(
    toUserMessage("something weird happened"),
    "An unexpected error occurred. Try summarizing again.",
  );
});

// ── Edge cases ──────────────────────────────────────────────────────────

test("toUserMessage handles null", () => {
  assert.strictEqual(
    toUserMessage(null),
    "An unexpected error occurred. Try summarizing again.",
  );
});

test("toUserMessage handles undefined", () => {
  assert.strictEqual(
    toUserMessage(undefined),
    "An unexpected error occurred. Try summarizing again.",
  );
});

test("toUserMessage handles an error with no message", () => {
  const err = new Error();
  assert.strictEqual(
    toUserMessage(err),
    "An unexpected error occurred. Try summarizing again.",
  );
});

test("toUserMessage uses a caller-supplied fallback when nothing matches", () => {
  assert.strictEqual(
    toUserMessage(
      new Error("EIO: weird disk thing"),
      "Couldn't read this file.",
    ),
    "Couldn't read this file.",
  );
});

test("toUserMessage still prefers a matching pattern over the caller fallback", () => {
  assert.strictEqual(
    toUserMessage(
      new Error("Failed to fetch (Ollama)"),
      "Couldn't read this file.",
    ),
    "Could not connect to Ollama. Make sure Ollama is running and check your Settings.",
  );
});
