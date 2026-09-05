import test from "node:test";
import assert from "node:assert";
import {
  ALLOWED_OLLAMA_HOSTS,
  DEFAULT_OLLAMA_PORT,
  validateLoopbackUrl,
  validateOllamaHost,
} from "../../lib/util/ollamaHost.js";

test("validateOllamaHost accepts default Ollama host http://127.0.0.1:11434", () => {
  const result = validateOllamaHost("http://127.0.0.1:11434");
  assert.strictEqual(result, "http://127.0.0.1:11434");
});

test("validateOllamaHost accepts default Ollama host http://localhost:11434", () => {
  const result = validateOllamaHost("http://localhost:11434");
  assert.strictEqual(result, "http://localhost:11434");
});

test("validateOllamaHost defaults missing port to 11434 for 127.0.0.1 and localhost", () => {
  assert.strictEqual(
    validateOllamaHost("http://127.0.0.1"),
    "http://127.0.0.1:11434",
  );
  assert.strictEqual(
    validateOllamaHost("http://localhost"),
    "http://localhost:11434",
  );
});

test("validateOllamaHost accepts custom valid numeric ports on loopback and strips trailing slashes", () => {
  assert.strictEqual(
    validateOllamaHost("http://127.0.0.1:11435/"),
    "http://127.0.0.1:11435",
  );
  assert.strictEqual(
    validateOllamaHost("http://localhost:8080///"),
    "http://localhost:8080",
  );
});

test("validateOllamaHost rejects non-http protocols", () => {
  assert.throws(
    () => validateOllamaHost("https://127.0.0.1:11434"),
    /Disallowed Ollama protocol: https:/,
  );
  assert.throws(
    () => validateOllamaHost("ftp://127.0.0.1:11434"),
    /Disallowed Ollama protocol: ftp:/,
  );
});

test("validateOllamaHost rejects non-loopback hostnames and remote IPs", () => {
  assert.throws(
    () => validateOllamaHost("http://example.com:11434"),
    /Disallowed Ollama host: example.com/,
  );
  assert.throws(
    () => validateOllamaHost("http://192.168.1.100:11434"),
    /Disallowed Ollama host: 192.168.1.100/,
  );
});

test("validateOllamaHost rejects invalid or out-of-range port numbers", () => {
  assert.throws(
    () => validateOllamaHost("http://127.0.0.1:0"),
    /Invalid Ollama (host|port)/,
  );
  assert.throws(
    () => validateOllamaHost("http://127.0.0.1:70000"),
    /Invalid Ollama (host|port)/,
  );
});

test("validateOllamaHost rejects malformed URLs", () => {
  assert.throws(
    () => validateOllamaHost("not a valid url"),
    /Invalid Ollama host/,
  );
});

test("the shared allowed set is exactly 127.0.0.1 and localhost, no IPv6 (#210)", () => {
  assert.deepStrictEqual(
    new Set(ALLOWED_OLLAMA_HOSTS),
    new Set(["127.0.0.1", "localhost"]),
  );
  assert.strictEqual(DEFAULT_OLLAMA_PORT, "11434");
  assert.throws(
    () => validateLoopbackUrl("http://[::1]:11434"),
    /Disallowed Ollama host/,
  );
  assert.throws(
    () => validateLoopbackUrl("http://[::1]:11434", { label: "llama.cpp" }),
    /Disallowed llama\.cpp host/,
  );
});

test("validateLoopbackUrl supports a per-provider default port (#210)", () => {
  assert.strictEqual(
    validateLoopbackUrl("http://127.0.0.1", { defaultPort: "8080" }),
    "http://127.0.0.1:8080",
  );
  assert.strictEqual(
    validateLoopbackUrl("http://localhost"),
    "http://localhost:11434",
  );
  assert.strictEqual(
    validateLoopbackUrl("http://127.0.0.1:9999", { defaultPort: "8080" }),
    "http://127.0.0.1:9999",
  );
});
