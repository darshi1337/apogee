import test from "node:test";
import assert from "node:assert";
import { sanitizeLogMessage } from "../../lib/util/log.js";

test("sanitizeLogMessage preserves clean, short log messages", () => {
  const input = "Offscreen document script initialized successfully.";
  assert.strictEqual(sanitizeLogMessage(input), input);
});

test("sanitizeLogMessage truncates messages exceeding maximum length", () => {
  const longMsg = "A".repeat(600);
  const sanitized = sanitizeLogMessage(longMsg, 500);
  assert.strictEqual(sanitized.length, 500 + "... [truncated]".length);
  assert.ok(sanitized.endsWith("... [truncated]"));
});

test("sanitizeLogMessage redacts URL query parameters", () => {
  const input =
    "Fetching model weights from https://huggingface.co/model.bin?token=secret123&user=test";
  const expected =
    "Fetching model weights from https://huggingface.co/model.bin?[redacted-query]";
  assert.strictEqual(sanitizeLogMessage(input), expected);
});

test("sanitizeLogMessage redacts sensitive host URLs", () => {
  const input =
    "Error extracting DOM from https://mail.google.com/mail/u/0/#inbox/12345";
  const expected = "Error extracting DOM from [redacted-sensitive-url]";
  assert.strictEqual(sanitizeLogMessage(input), expected);
});

test("sanitizeLogMessage redacts user credentials in URLs", () => {
  const input = "Connecting to http://admin:secret123@example.com/api";
  const expected =
    "Connecting to http://[redacted-credentials]@example.com/api";
  assert.strictEqual(sanitizeLogMessage(input), expected);
});

test("sanitizeLogMessage redacts file, data, and blob URLs", () => {
  const fileInput = "Failed to load file:///C:/Users/Darshi/secret.pdf";
  assert.strictEqual(
    sanitizeLogMessage(fileInput),
    "Failed to load file://[redacted-file-url]",
  );

  const dataInput =
    "Image loaded data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...";
  assert.strictEqual(
    sanitizeLogMessage(dataInput),
    "Image loaded data:[redacted-data-url]",
  );

  const blobInput = "Stream created blob:http://localhost/1234-5678";
  assert.strictEqual(
    sanitizeLogMessage(blobInput),
    "Stream created blob:[redacted-blob-url]",
  );
});

test("sanitizeLogMessage redacts Bearer tokens and secret key parameters", () => {
  const bearerInput =
    "Header set: Authorization: Bearer eyJhbGciOiJIUzI1NiIn...";
  assert.strictEqual(
    sanitizeLogMessage(bearerInput),
    "Header set: Authorization: Bearer [redacted-token]",
  );

  const keyInput = "Config loaded api_key=sk-1234567890abcdef1234567890";
  assert.strictEqual(
    sanitizeLogMessage(keyInput),
    "Config loaded api_key=[redacted]",
  );
});

test("sanitizeLogMessage redacts JSON and YAML-style credential forms", () => {
  const jsonInput = '{"apiKey":"json-secret","access_token":"access-secret"}';
  const yamlInput = "api-key: yaml-secret secret-token: another-secret";

  assert.strictEqual(
    sanitizeLogMessage(jsonInput),
    '{"apiKey":"[redacted]","access_token":"[redacted]"}',
  );
  assert.strictEqual(
    sanitizeLogMessage(yamlInput),
    "api-key: [redacted] secret-token: [redacted]",
  );
});

test("sanitizeLogMessage redacts password-style keys but not author", () => {
  assert.strictEqual(
    sanitizeLogMessage("login password=hunter2 pwd=x token=abc"),
    "login password=[redacted] pwd=[redacted] token=[redacted]",
  );
  assert.strictEqual(sanitizeLogMessage("author=John"), "author=John");
});

test("sanitizeLogMessage handles null and undefined inputs gracefully", () => {
  assert.strictEqual(sanitizeLogMessage(null), "");
  assert.strictEqual(sanitizeLogMessage(undefined), "");
});
