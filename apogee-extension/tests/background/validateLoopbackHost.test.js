import test from "node:test";
import assert from "node:assert";

import {
  validateLoopbackHost,
  loopbackDefaultPort,
  rejectLoopbackHost,
  ALLOWED_LOOPBACK_HOSTS,
} from "../../background/loopbackProviders.js";
import { ALLOWED_OLLAMA_HOSTS } from "../../lib/util/ollamaHost.js";
import { UserFacingError } from "../../lib/util/userError.js";

test("validateLoopbackHost throws a UserFacingError rather than a plain Error (#157)", () => {
  assert.throws(
    () => validateLoopbackHost("https://evil.example:9999"),
    (err) => err instanceof UserFacingError && err.name === "UserFacingError",
  );
});

test("validateLoopbackHost's rejection states the rule, not an internal assertion (#157)", () => {
  const err = tryValidate("https://evil.example:9999");
  assert.match(err.message, /can only reach/i);
  assert.match(err.message, /Check the host in Settings/);
});

test("validateLoopbackHost keeps the rejected value out of the user-facing message (#157)", () => {
  const err = tryValidate("http://evil.example:1234");
  assert.ok(!err.message.includes("evil.example"), "host leaks into message");
  assert.ok(!err.message.includes("1234"), "reason leaks into message");
});

test("validateLoopbackHost's message is built from ALLOWED_LOOPBACK_HOSTS, not hardcoded (#157)", () => {
  assert.equal(ALLOWED_LOOPBACK_HOSTS, ALLOWED_OLLAMA_HOSTS);
  const err = tryValidate("not-a-url");
  for (const host of ALLOWED_OLLAMA_HOSTS) {
    assert.ok(err.message.includes(host), `message names ${host}`);
  }
});

test("rejectLoopbackHost logs the rejected value to the console only (#157)", () => {
  const lines = [];
  const orig = console.error;
  console.error = (msg) => void lines.push(String(msg));
  try {
    rejectLoopbackHost("Ollama", "http://evil.example:1234", "nope");
  } finally {
    console.error = orig;
  }
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("evil.example"), "console keeps the value");
});

test("validateLoopbackHost shares the allowed set with lib/util/ollamaHost.js (#210)", () => {
  assert.equal(
    validateLoopbackHost("http://127.0.0.1:11434"),
    "http://127.0.0.1:11434",
  );
  assert.throws(
    () => validateLoopbackHost("http://example.com"),
    UserFacingError,
  );
});

test("validateLoopbackHost applies the shared port check with a per-provider default (#210)", () => {
  assert.equal(loopbackDefaultPort("Ollama"), "11434");
  assert.equal(loopbackDefaultPort("llama.cpp"), "8080");
  assert.equal(
    validateLoopbackHost("http://127.0.0.1", "Ollama"),
    "http://127.0.0.1:11434",
  );
  assert.equal(
    validateLoopbackHost("http://127.0.0.1", "llama.cpp"),
    "http://127.0.0.1:8080",
  );
});

function tryValidate(host) {
  try {
    validateLoopbackHost(host);
  } catch (err) {
    return err;
  }
  throw new Error(`expected validateLoopbackHost(${host}) to throw`);
}
