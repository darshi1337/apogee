import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  TAB_ID_NONE,
  LOOPBACK_CORS_STATIC_RULE_ID,
  buildLoopbackCorsSessionRule,
  ensureLoopbackCorsRule,
  resetLoopbackCorsRuleForTests,
} from "../../lib/util/loopbackCors.js";

test("session rule strips Origin on loopback hosts for non-tab requests only", () => {
  const rule = buildLoopbackCorsSessionRule();
  assert.deepStrictEqual(rule.condition.tabIds, [TAB_ID_NONE]);
  assert.deepStrictEqual(rule.condition.requestDomains, [
    "localhost",
    "127.0.0.1",
  ]);
  assert.deepStrictEqual(rule.condition.excludedInitiatorDomains, [
    "localhost",
    "127.0.0.1",
  ]);
  assert.deepStrictEqual(rule.condition.resourceTypes, ["xmlhttprequest"]);
  assert.deepStrictEqual(rule.action, {
    type: "modifyHeaders",
    requestHeaders: [{ header: "origin", operation: "remove" }],
  });
});

test("ensureLoopbackCorsRule reports unsupported without declarativeNetRequest", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  delete globalThis.chrome;
  try {
    assert.strictEqual(await ensureLoopbackCorsRule(), "unsupported");
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("ensureLoopbackCorsRule registers the session rule and disables the static fallback", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  const sessionCalls = [];
  const staticCalls = [];
  globalThis.chrome = {
    declarativeNetRequest: {
      updateSessionRules: async (opts) => {
        sessionCalls.push(opts);
      },
      updateStaticRules: async (opts) => {
        staticCalls.push(opts);
      },
    },
  };
  try {
    assert.strictEqual(await ensureLoopbackCorsRule(), "session");
    assert.strictEqual(sessionCalls.length, 1);
    assert.deepStrictEqual(sessionCalls[0].removeRuleIds, [1]);
    assert.strictEqual(sessionCalls[0].addRules.length, 1);
    assert.deepStrictEqual(sessionCalls[0].addRules[0].condition.tabIds, [
      TAB_ID_NONE,
    ]);
    assert.deepStrictEqual(staticCalls, [
      { disableRuleIds: [LOOPBACK_CORS_STATIC_RULE_ID] },
    ]);
    // Cached: a second call issues no further rule updates.
    assert.strictEqual(await ensureLoopbackCorsRule(), "session");
    assert.strictEqual(sessionCalls.length, 1);
    assert.strictEqual(staticCalls.length, 1);
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("ensureLoopbackCorsRule falls back when session rules are rejected", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  globalThis.chrome = {
    declarativeNetRequest: {
      updateSessionRules: async () => {
        throw new Error("not supported");
      },
    },
  };
  try {
    assert.strictEqual(await ensureLoopbackCorsRule(), "static-fallback");
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("ensureLoopbackCorsRule stays session-scoped when static disable fails", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  globalThis.chrome = {
    declarativeNetRequest: {
      updateSessionRules: async () => {},
      updateStaticRules: async () => {
        throw new Error("not supported");
      },
    },
  };
  try {
    assert.strictEqual(await ensureLoopbackCorsRule(), "session");
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("bundled static fallback rule stays restricted to loopback request hosts", () => {
  const rules = JSON.parse(
    readFileSync(
      new URL("../../rules/ollama-cors.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(rules) && rules.length > 0);
  for (const rule of rules) {
    for (const host of rule.condition.requestDomains || []) {
      assert.ok(
        host === "localhost" || host === "127.0.0.1",
        `static rule request host ${host} must be loopback`,
      );
    }
  }
});
