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
  assert.equal(typeof summary.networkEgress.statusMessage, "string");
  assert.equal(typeof summary.storageRetention.saveHistory, "boolean");
});

test("getActivityAuditSummary reports zero egress when SponsorBlock is off", async () => {
  storageMap.clear();
  await chrome.storage.local.set({ settings: { useSponsorBlock: false } });

  const summary = await getActivityAuditSummary();
  assert.equal(summary.networkEgress.sponsorBlockActive, false);
  assert.equal(summary.networkEgress.zeroEgress, true);
});

test("getActivityAuditSummary reports SponsorBlock active by default", async () => {
  storageMap.clear();

  const summary = await getActivityAuditSummary();
  assert.equal(summary.networkEgress.sponsorBlockActive, true);
  assert.equal(summary.networkEgress.zeroEgress, false);
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
