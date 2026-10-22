import test from "node:test";
import assert from "node:assert/strict";
import { createConnectionError } from "../../lib/util/connectionError.js";
import { UserFacingError } from "../../lib/util/userError.js";

class FakeError extends UserFacingError {}

test("connection errors keep the raw browser string out of the message", (t) => {
  t.mock.method(console, "error", () => {});
  const err = createConnectionError(
    FakeError,
    "Ollama",
    "http://127.0.0.1:11434",
    new TypeError("Failed to fetch"),
  );
  assert.equal(err.isUserFacing, true);
  assert.match(
    err.message,
    /Could not connect to Ollama at http:\/\/127\.0\.0\.1:11434/,
  );
  assert.doesNotMatch(err.message, /Failed to fetch|TypeError|Error:/);
});
