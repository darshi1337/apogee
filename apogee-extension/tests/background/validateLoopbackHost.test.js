import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const swCode = fs.readFileSync(
  new URL("../../background/service-worker.js", import.meta.url),
  "utf-8",
);

const fnMatch = swCode.match(/function validateLoopbackHost[\s\S]*?\n\}/);
assert.ok(fnMatch, "validateLoopbackHost function found");
const fnBody = fnMatch[0];

test("validateLoopbackHost throws a UserFacingError rather than a plain Error (#157)", () => {
  assert.match(fnBody, /throw rejectLoopbackHost\(/);
  assert.doesNotMatch(fnBody, /throw new Error\(/);
});

test("validateLoopbackHost's rejection states the rule, not an internal assertion (#157)", () => {
  const helperMatch = swCode.match(/function rejectLoopbackHost[\s\S]*?\n\}/);
  assert.ok(helperMatch, "rejectLoopbackHost helper found");
  const helperBody = helperMatch[0];

  assert.match(helperBody, /new UserFacingError/);
  assert.match(helperBody, /can only reach/i);
  assert.match(helperBody, /Check the host in Settings/);
});

test("validateLoopbackHost keeps the rejected value out of the user-facing message (#157)", () => {
  const helperMatch = swCode.match(/function rejectLoopbackHost[\s\S]*?\n\}/);
  const helperBody = helperMatch[0];

  // The UserFacingError constructor call itself must not interpolate the rejected host/reason - only the console.error line may.
  const userFacingErrorCall = helperBody.match(
    /new UserFacingError\(([\s\S]*?)\);/,
  )[1];
  assert.doesNotMatch(userFacingErrorCall, /\$\{host\}/);
  assert.doesNotMatch(userFacingErrorCall, /\$\{reason\}/);

  assert.match(helperBody, /console\.error\(.*\$\{.*host.*reason.*\)/s);
});

test("validateLoopbackHost's message is built from ALLOWED_LOOPBACK_HOSTS, not hardcoded (#157)", () => {
  const helperMatch = swCode.match(/function rejectLoopbackHost[\s\S]*?\n\}/);
  const helperBody = helperMatch[0];
  assert.match(helperBody, /ALLOWED_LOOPBACK_HOSTS/);
});

test("validateLoopbackHost shares the allowed set with lib/util/ollamaHost.js (#210)", () => {
  assert.match(
    swCode,
    /from "\.\.\/lib\/util\/ollamaHost\.js"/,
    "service worker must import the shared loopback validator",
  );
  assert.match(swCode, /validateLoopbackUrl/);
  assert.match(
    swCode,
    /const ALLOWED_LOOPBACK_HOSTS\s*=\s*ALLOWED_OLLAMA_HOSTS/,
    "the allowed set must alias the shared set so they cannot diverge",
  );
});

test("validateLoopbackHost applies the shared port check with a per-provider default (#210)", () => {
  assert.match(fnBody, /validateLoopbackUrl/);
  assert.match(fnBody, /defaultPort/);
  assert.ok(
    /label === LLAMACPP_PROVIDER\.label/.test(swCode),
    "llama.cpp hosts must default to the llama port, not the Ollama one",
  );
});
