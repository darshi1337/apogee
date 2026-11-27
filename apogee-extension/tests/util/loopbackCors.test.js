import test from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import {
  TAB_ID_NONE,
  LOOPBACK_HOSTS,
  LOOPBACK_CORS_SESSION_RULE_ID,
  getExtensionInitiatorDomain,
  buildLoopbackCorsSessionRule,
  ensureLoopbackCorsRule,
  ensureLoopbackCorsRuleSoon,
  resetLoopbackCorsRuleForTests,
} from "../../lib/util/loopbackCors.js";

const CHROME_EXT_ID = "pgemlpomhkdcjjjcpnjlebalnfglomog";
const FIREFOX_EXT_UUID = "12345678-1234-1234-1234-123456789abc";

function hostMatchesDomainList(host, domains) {
  const normalized = host.toLowerCase();
  return domains.some((domain) => {
    const d = domain.toLowerCase();
    return normalized === d || normalized.endsWith(`.${d}`);
  });
}

function matchesDnrRule(rule, request) {
  const condition = rule.condition || {};
  const requestHost = new URL(request.url).hostname.toLowerCase();
  const initiatorHost = request.initiator
    ? new URL(request.initiator).hostname.toLowerCase()
    : "";

  if (
    condition.requestDomains &&
    !hostMatchesDomainList(requestHost, condition.requestDomains)
  ) {
    return false;
  }
  if (
    condition.excludedInitiatorDomains &&
    initiatorHost &&
    hostMatchesDomainList(initiatorHost, condition.excludedInitiatorDomains)
  ) {
    return false;
  }
  if (
    condition.initiatorDomains &&
    (!initiatorHost ||
      !hostMatchesDomainList(initiatorHost, condition.initiatorDomains))
  ) {
    return false;
  }
  if (
    condition.resourceTypes &&
    !condition.resourceTypes.includes(request.resourceType)
  ) {
    return false;
  }
  if (condition.tabIds && !condition.tabIds.includes(request.tabId)) {
    return false;
  }
  return true;
}

function applyDnrRules(rules, request) {
  const headers = { ...(request.headers || {}) };
  for (const rule of rules) {
    if (!matchesDnrRule(rule, request)) continue;
    if (rule.action?.type === "modifyHeaders") {
      for (const op of rule.action.requestHeaders || []) {
        if (op.operation === "remove") {
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === op.header.toLowerCase()) {
              delete headers[key];
            }
          }
        }
      }
    }
  }
  return headers;
}

function loadEnabledStaticRulesFromManifest() {
  const manifestUrl = new URL("../../manifest.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  const resources = manifest.declarative_net_request?.rule_resources || [];
  const rules = [];
  for (const resource of resources) {
    if (resource.enabled === false) continue;
    const ruleUrl = new URL(`../../${resource.path}`, import.meta.url);
    rules.push(...JSON.parse(readFileSync(ruleUrl, "utf8")));
  }
  return rules;
}

test("getExtensionInitiatorDomain resolves Chrome and Firefox extension hosts", () => {
  const originalChrome = globalThis.chrome;
  try {
    delete globalThis.chrome;
    assert.strictEqual(getExtensionInitiatorDomain(), null);

    globalThis.chrome = {
      runtime: {
        id: CHROME_EXT_ID,
        getURL: (p = "") => `chrome-extension://${CHROME_EXT_ID}/${p}`,
      },
    };
    assert.strictEqual(getExtensionInitiatorDomain(), CHROME_EXT_ID);

    // Firefox sets runtime.id to the add-on ID ("apogee@darshi.dev"), while
    // requests carry the moz-extension://<uuid> origin.
    globalThis.chrome = {
      runtime: {
        id: "apogee@darshi.dev",
        getURL: (p = "") => `moz-extension://${FIREFOX_EXT_UUID}/${p}`,
      },
    };
    assert.strictEqual(getExtensionInitiatorDomain(), FIREFOX_EXT_UUID);

    // Without getURL, Firefox add-on IDs containing "@" must not be used.
    globalThis.chrome = {
      runtime: {
        id: "apogee@darshi.dev",
      },
    };
    assert.strictEqual(getExtensionInitiatorDomain(), null);

    // Without getURL, a valid Chromium extension ID falls back cleanly.
    globalThis.chrome = {
      runtime: {
        id: CHROME_EXT_ID,
      },
    };
    assert.strictEqual(getExtensionInitiatorDomain(), CHROME_EXT_ID);

    // Non-URL getURL stub falls back cleanly to runtime.id.
    globalThis.chrome = {
      runtime: {
        id: CHROME_EXT_ID,
        getURL: () => "not-a-valid-url",
      },
    };
    assert.strictEqual(getExtensionInitiatorDomain(), CHROME_EXT_ID);

    // Loopback hosts are never accepted as an extension initiator domain.
    globalThis.chrome = {
      runtime: {
        getURL: () => "http://localhost/",
      },
    };
    assert.strictEqual(getExtensionInitiatorDomain(), null);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("session rule strips Origin on loopback hosts for this extension's non-tab requests only", () => {
  const rule = buildLoopbackCorsSessionRule(CHROME_EXT_ID);
  assert.strictEqual(rule.id, LOOPBACK_CORS_SESSION_RULE_ID);
  assert.deepStrictEqual(rule.condition.tabIds, [TAB_ID_NONE]);
  assert.deepStrictEqual(rule.condition.initiatorDomains, [CHROME_EXT_ID]);
  assert.deepStrictEqual(rule.condition.requestDomains, [...LOOPBACK_HOSTS]);
  assert.deepStrictEqual(rule.condition.excludedInitiatorDomains, [
    ...LOOPBACK_HOSTS,
  ]);
  assert.ok(rule.condition.requestDomains.includes("localhost"));
  assert.ok(rule.condition.requestDomains.includes("127.0.0.1"));
  assert.ok(rule.condition.requestDomains.includes("[::1]"));
  assert.ok(!rule.condition.requestDomains.includes("::1"));
  assert.deepStrictEqual(rule.condition.resourceTypes, ["xmlhttprequest"]);
  assert.deepStrictEqual(rule.action, {
    type: "modifyHeaders",
    requestHeaders: [{ header: "origin", operation: "remove" }],
  });

  assert.throws(
    () => buildLoopbackCorsSessionRule(null),
    /Extension initiator domain is required/,
  );
  assert.throws(
    () => buildLoopbackCorsSessionRule("localhost"),
    /Extension initiator domain is required/,
  );
});

test("website-initiated loopback requests keep their Origin header (#726)", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();

  const staticRules = loadEnabledStaticRulesFromManifest();
  assert.deepStrictEqual(
    staticRules,
    [],
    "no broad static fallback rules should be enabled in manifest.json",
  );
  assert.strictEqual(
    existsSync(new URL("../../rules/ollama-cors.json", import.meta.url)),
    false,
    "rules/ollama-cors.json fallback should be removed",
  );

  for (const runtimeEnv of [
    {
      name: "Chrome",
      origin: `chrome-extension://${CHROME_EXT_ID}`,
      runtime: {
        id: CHROME_EXT_ID,
        getURL: (p = "") => `chrome-extension://${CHROME_EXT_ID}/${p}`,
      },
    },
    {
      name: "Firefox",
      origin: `moz-extension://${FIREFOX_EXT_UUID}`,
      runtime: {
        id: "apogee@darshi.dev",
        getURL: (p = "") => `moz-extension://${FIREFOX_EXT_UUID}/${p}`,
      },
    },
  ]) {
    resetLoopbackCorsRuleForTests();
    let activeSessionRules = [];
    globalThis.chrome = {
      runtime: runtimeEnv.runtime,
      declarativeNetRequest: {
        updateSessionRules: async (opts) => {
          const remove = new Set(opts.removeRuleIds || []);
          activeSessionRules = activeSessionRules.filter(
            (r) => !remove.has(r.id),
          );
          activeSessionRules.push(...(opts.addRules || []));
        },
      },
    };

    try {
      assert.strictEqual(await ensureLoopbackCorsRule(), "session");
      const activeRules = [...staticRules, ...activeSessionRules];

      // Website tab requests to every loopback host must keep Origin.
      for (const targetUrl of [
        "http://127.0.0.1:11434/api/chat",
        "http://localhost:8080/v1/chat/completions",
        "http://[::1]:11434/api/tags",
      ]) {
        const result = applyDnrRules(activeRules, {
          url: targetUrl,
          initiator: "https://evil.example",
          tabId: 42,
          resourceType: "xmlhttprequest",
          headers: { Origin: "https://evil.example" },
        });
        assert.strictEqual(
          result.Origin,
          "https://evil.example",
          `${runtimeEnv.name}: website tab request to ${targetUrl} must keep Origin`,
        );

        // Website service worker / shared worker requests carry tabId -1 but
        // still have a website initiator and must keep Origin.
        const workerResult = applyDnrRules(activeRules, {
          url: targetUrl,
          initiator: "https://evil.example",
          tabId: TAB_ID_NONE,
          resourceType: "xmlhttprequest",
          headers: { Origin: "https://evil.example" },
        });
        assert.strictEqual(
          workerResult.Origin,
          "https://evil.example",
          `${runtimeEnv.name}: website worker request to ${targetUrl} must keep Origin`,
        );

        // Local dev server requests must keep Origin.
        const devServerResult = applyDnrRules(activeRules, {
          url: targetUrl,
          initiator: "http://localhost:3000",
          tabId: 7,
          resourceType: "xmlhttprequest",
          headers: { Origin: "http://localhost:3000" },
        });
        assert.strictEqual(
          devServerResult.Origin,
          "http://localhost:3000",
          `${runtimeEnv.name}: local dev server request to ${targetUrl} must keep Origin`,
        );

        // Requests from another extension must keep Origin.
        const otherExtOrigin =
          "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const otherExtResult = applyDnrRules(activeRules, {
          url: targetUrl,
          initiator: otherExtOrigin,
          tabId: TAB_ID_NONE,
          resourceType: "xmlhttprequest",
          headers: { Origin: otherExtOrigin },
        });
        assert.strictEqual(
          otherExtResult.Origin,
          otherExtOrigin,
          `${runtimeEnv.name}: another extension's request to ${targetUrl} must keep Origin`,
        );

        // Apogee's own background/non-tab requests must strip Origin.
        const extResult = applyDnrRules(activeRules, {
          url: targetUrl,
          initiator: runtimeEnv.origin,
          tabId: TAB_ID_NONE,
          resourceType: "xmlhttprequest",
          headers: { Origin: runtimeEnv.origin },
        });
        assert.strictEqual(
          extResult.Origin,
          undefined,
          `${runtimeEnv.name}: Apogee's own request to ${targetUrl} should strip Origin`,
        );
      }
    } finally {
      globalThis.chrome = originalChrome;
      resetLoopbackCorsRuleForTests();
    }
  }
});

test("ensureLoopbackCorsRule reports unsupported without declarativeNetRequest or extension identity", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  try {
    delete globalThis.chrome;
    assert.strictEqual(await ensureLoopbackCorsRule(), "unsupported");

    resetLoopbackCorsRuleForTests();
    globalThis.chrome = {
      declarativeNetRequest: {
        updateSessionRules: async () => {
          throw new Error("should not be called without extension domain");
        },
      },
    };
    assert.strictEqual(await ensureLoopbackCorsRule(), "unsupported");
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("ensureLoopbackCorsRule registers the extension-scoped session rule once and caches it", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  const sessionCalls = [];
  globalThis.chrome = {
    runtime: {
      id: CHROME_EXT_ID,
      getURL: (p = "") => `chrome-extension://${CHROME_EXT_ID}/${p}`,
    },
    declarativeNetRequest: {
      updateSessionRules: async (opts) => {
        sessionCalls.push(opts);
      },
    },
  };
  try {
    assert.strictEqual(await ensureLoopbackCorsRule(), "session");
    assert.strictEqual(sessionCalls.length, 1);
    assert.deepStrictEqual(sessionCalls[0].removeRuleIds, [
      LOOPBACK_CORS_SESSION_RULE_ID,
    ]);
    assert.strictEqual(sessionCalls[0].addRules.length, 1);
    assert.deepStrictEqual(sessionCalls[0].addRules[0].condition.tabIds, [
      TAB_ID_NONE,
    ]);
    assert.deepStrictEqual(
      sessionCalls[0].addRules[0].condition.initiatorDomains,
      [CHROME_EXT_ID],
    );
    // Cached: a second call issues no further rule updates.
    assert.strictEqual(await ensureLoopbackCorsRule(), "session");
    assert.strictEqual(sessionCalls.length, 1);
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("ensureLoopbackCorsRule fails closed without static fallback when session rules are rejected", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  globalThis.chrome = {
    runtime: {
      id: CHROME_EXT_ID,
      getURL: (p = "") => `chrome-extension://${CHROME_EXT_ID}/${p}`,
    },
    declarativeNetRequest: {
      updateSessionRules: async () => {
        throw new Error("not supported");
      },
    },
  };
  try {
    assert.strictEqual(await ensureLoopbackCorsRule(), "unavailable");
    // With no static fallback, website requests still keep their Origin header.
    const staticRules = loadEnabledStaticRulesFromManifest();
    const result = applyDnrRules(staticRules, {
      url: "http://127.0.0.1:11434/api/chat",
      initiator: "https://example.com",
      tabId: 1,
      resourceType: "xmlhttprequest",
      headers: { Origin: "https://example.com" },
    });
    assert.strictEqual(result.Origin, "https://example.com");
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("ensureLoopbackCorsRuleSoon passes the registration result through", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  delete globalThis.chrome;
  try {
    assert.strictEqual(await ensureLoopbackCorsRuleSoon(50), "unsupported");
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});

test("ensureLoopbackCorsRuleSoon times out instead of blocking the first request", async () => {
  const originalChrome = globalThis.chrome;
  resetLoopbackCorsRuleForTests();
  globalThis.chrome = {
    runtime: {
      id: CHROME_EXT_ID,
      getURL: (p = "") => `chrome-extension://${CHROME_EXT_ID}/${p}`,
    },
    declarativeNetRequest: {
      updateSessionRules: () => new Promise(() => {}),
    },
  };
  try {
    assert.strictEqual(await ensureLoopbackCorsRuleSoon(20), "timeout");
  } finally {
    globalThis.chrome = originalChrome;
    resetLoopbackCorsRuleForTests();
  }
});
