import test from "node:test";
import assert from "node:assert/strict";
import {
  recordPageAccessEvent,
  getPageAccessLog,
  getActivityAuditSummary,
} from "../../lib/storage/activityAudit.js";

// Mock chrome storage
const storageMap = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys === null) {
          const res = {};
          for (const [k, v] of storageMap.entries()) res[k] = v;
          return res;
        }
        if (typeof keys === "string") {
          return storageMap.has(keys) ? { [keys]: storageMap.get(keys) } : {};
        }
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) {
            if (storageMap.has(k)) res[k] = storageMap.get(k);
          }
          return res;
        }
        return {};
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) storageMap.set(k, v);
      },
      remove: async (keys) => {
        for (const k of keys) storageMap.delete(k);
      },
    },
  },
};

test("recordPageAccessEvent stores audit entries and caps at 20", async () => {
  storageMap.clear();
  for (let i = 1; i <= 25; i++) {
    await recordPageAccessEvent({
      title: `Test Page ${i}`,
      url: `https://example.com/page${i}`,
      contentLength: 500 * i,
      type: "generic",
    });
  }

  const logs = await getPageAccessLog();
  assert.equal(logs.length, 20);
  assert.equal(logs[0].title, "Test Page 25");
});

test("recordPageAccessEvent leaves a missing title for the UI to localize", async () => {
  storageMap.clear();
  await recordPageAccessEvent({
    url: "https://example.com/no-title",
    contentLength: 10,
    type: "generic",
  });

  const [entry] = await getPageAccessLog();
  assert.equal(entry.title, "");
});

test("getActivityAuditSummary returns privacy & activity audit metrics", async () => {
  storageMap.clear();
  await recordPageAccessEvent({
    title: "Privacy Test",
    url: "https://example.org",
    contentLength: 1200,
    type: "article",
  });

  const summary = await getActivityAuditSummary();
  assert.equal(summary.pageAccessCount, 1);
  assert.equal(summary.networkEgress.status, "localSponsorBlock");
  assert.equal(typeof summary.storageRetention.saveHistory, "boolean");
});

test("getActivityAuditSummary reports zero egress when SponsorBlock is off", async () => {
  storageMap.clear();
  await chrome.storage.local.set({ settings: { useSponsorBlock: false } });

  const summary = await getActivityAuditSummary();
  assert.equal(summary.networkEgress.sponsorBlockActive, false);
  assert.equal(summary.networkEgress.zeroEgress, true);
  assert.equal(summary.networkEgress.status, "local");
});

test("getActivityAuditSummary reports SponsorBlock active by default", async () => {
  storageMap.clear();

  const summary = await getActivityAuditSummary();
  assert.equal(summary.networkEgress.sponsorBlockActive, true);
  assert.equal(summary.networkEgress.zeroEgress, false);
  assert.equal(summary.networkEgress.status, "localSponsorBlock");
});

for (const provider of ["openrouter", "opencode"]) {
  test(`audit identifies ${provider} catalog access without claiming remote inference`, async () => {
    storageMap.clear();
    await chrome.storage.local.set({
      settings: {
        useSponsorBlock: false,
        [`${provider}Consent`]: true,
        [`${provider}ApiKey`]: "secret",
      },
    });
    const { networkEgress } = await getActivityAuditSummary();
    assert.equal(networkEgress.zeroEgress, false);
    assert.equal(networkEgress.remoteCatalogActive, true);
    assert.equal(networkEgress.status, "remoteCatalog");
  });

  test(`audit distinguishes ${provider} generation consent from catalog access`, async () => {
    storageMap.clear();
    await chrome.storage.local.set({
      settings: {
        useSponsorBlock: false,
        [`${provider}Consent`]: true,
        [`${provider}GenerationConsent`]: true,
        [`${provider}ApiKey`]: "private-key",
      },
    });
    const summary = await getActivityAuditSummary();
    assert.equal(summary.networkEgress.remoteCatalogActive, true);
    assert.equal(summary.networkEgress.remoteGenerationActive, true);
    assert.equal(summary.networkEgress.zeroEgress, false);
    assert.equal(summary.networkEgress.status, "remoteGeneration");
    assert.equal(JSON.stringify(summary).includes("private-key"), false);
  });
}

test("generation consent without catalog consent or a key stays inactive", async () => {
  for (const credentials of [
    { openrouterConsent: false, openrouterApiKey: "secret" },
    { openrouterConsent: true, openrouterApiKey: "" },
  ]) {
    storageMap.clear();
    await chrome.storage.local.set({
      settings: {
        ...credentials,
        openrouterGenerationConsent: true,
        useSponsorBlock: false,
      },
    });
    const { networkEgress } = await getActivityAuditSummary();
    assert.equal(networkEgress.remoteGenerationActive, false);
    assert.equal(networkEgress.remoteCatalogActive, false);
    assert.equal(networkEgress.status, "local");
  }
});

test("generation capability label includes SponsorBlock independently", async () => {
  storageMap.clear();
  await chrome.storage.local.set({
    settings: {
      openrouterConsent: true,
      openrouterGenerationConsent: true,
      openrouterApiKey: "secret",
    },
  });
  const { networkEgress } = await getActivityAuditSummary();
  assert.equal(networkEgress.status, "remoteGenerationSponsorBlock");
});

test("audit does not claim catalog access when consent has no key", async () => {
  storageMap.clear();
  await chrome.storage.local.set({
    settings: { useSponsorBlock: false, openrouterConsent: true },
  });
  const { networkEgress } = await getActivityAuditSummary();
  assert.equal(networkEgress.zeroEgress, true);
  assert.equal(networkEgress.remoteCatalogActive, false);
  assert.equal(networkEgress.status, "local");
});

test("audit includes both optional catalog and SponsorBlock access", async () => {
  storageMap.clear();
  await chrome.storage.local.set({
    settings: { openrouterConsent: true, openrouterApiKey: "secret" },
  });
  const { networkEgress } = await getActivityAuditSummary();
  assert.equal(networkEgress.status, "remoteCatalogSponsorBlock");
});

test("audit does not claim remote access after the Firefox permission is removed", async () => {
  storageMap.clear();
  const previousBrowser = process.env.TARGET_BROWSER;
  const previousPermissions = chrome.permissions;
  process.env.TARGET_BROWSER = "firefox";
  chrome.permissions = { contains: async () => false };
  try {
    await chrome.storage.local.set({
      settings: {
        useSponsorBlock: false,
        openrouterConsent: true,
        openrouterGenerationConsent: true,
        openrouterApiKey: "secret",
      },
    });
    const { networkEgress } = await getActivityAuditSummary();
    assert.equal(networkEgress.remoteCatalogActive, false);
    assert.equal(networkEgress.remoteGenerationActive, false);
    assert.equal(networkEgress.zeroEgress, true);
    assert.equal(networkEgress.status, "local");
  } finally {
    if (previousBrowser === undefined) delete process.env.TARGET_BROWSER;
    else process.env.TARGET_BROWSER = previousBrowser;
    if (previousPermissions === undefined) delete chrome.permissions;
    else chrome.permissions = previousPermissions;
  }
});

test("recordPageAccessEvent skips sensitive pages even with history on (#181)", async () => {
  storageMap.clear();
  await recordPageAccessEvent({
    title: "Inbox",
    url: "https://mail.google.com/mail/u/0/#inbox",
    contentLength: 900,
    type: "generic",
  });

  const logs = await getPageAccessLog();
  assert.equal(logs.length, 0);
});

test("recordPageAccessEvent skips all pages when saveHistory is off (#181)", async () => {
  storageMap.clear();
  await chrome.storage.local.set({ settings: { saveHistory: false } });
  await recordPageAccessEvent({
    title: "A normal article",
    url: "https://example.com/article",
    contentLength: 900,
    type: "article",
  });

  const logs = await getPageAccessLog();
  assert.equal(logs.length, 0);
});

test("getActivityAuditSummary reports saveHistory false when history is off", async () => {
  storageMap.clear();
  await chrome.storage.local.set({ settings: { saveHistory: false } });

  const summary = await getActivityAuditSummary();
  assert.equal(summary.storageRetention.saveHistory, false);
});

test("getActivityAuditSummary counts real cached-page keys (#208)", async () => {
  storageMap.clear();
  await chrome.storage.local.set({
    "summary:bullets:auto:m:abc": "text",
    "suggested-prompts:bullets:auto:m:abc": ["q?"],
    "content:def": { title: "t" },
    cacheOrder: [
      {
        s: "summary:bullets:auto:m:abc",
        p: "suggested-prompts:bullets:auto:m:abc",
      },
    ],
    contentCacheOrder: ["content:def"],
    unrelated: 1,
  });

  const summary = await getActivityAuditSummary();
  assert.equal(summary.storageRetention.cachedPagesCount, 3);
});
