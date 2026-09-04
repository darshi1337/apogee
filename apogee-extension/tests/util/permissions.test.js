import test from "node:test";
import assert from "node:assert";

import {
  hasHostPermissions,
  requestHostPermissions,
  getOptionalOriginsForUrl,
  ensurePermissionsForUrl,
} from "../../lib/util/permissions.js";

test("hasHostPermissions returns false when chrome.permissions is undefined (#209)", async () => {
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  try {
    const result = await hasHostPermissions(["*://*.bilibili.com/*"]);
    assert.strictEqual(result, false);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("hasHostPermissions calls chrome.permissions.contains and returns true/false", async () => {
  const originalChrome = globalThis.chrome;
  let queriedOrigins = null;

  globalThis.chrome = {
    permissions: {
      contains({ origins }, callback) {
        queriedOrigins = origins;
        callback(origins.includes("*://*.bilibili.com/*"));
      },
    },
  };

  try {
    const hasBili = await hasHostPermissions(["*://*.bilibili.com/*"]);
    assert.strictEqual(hasBili, true);
    assert.deepStrictEqual(queriedOrigins, ["*://*.bilibili.com/*"]);

    const hasYoutube = await hasHostPermissions(["*://*.youtube.com/*"]);
    assert.strictEqual(hasYoutube, false);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("requestHostPermissions calls chrome.permissions.request and returns granted boolean", async () => {
  const originalChrome = globalThis.chrome;
  let requestedOrigins = null;

  globalThis.chrome = {
    permissions: {
      request({ origins }, callback) {
        requestedOrigins = origins;
        callback(true);
      },
    },
  };

  try {
    const granted = await requestHostPermissions(["*://*.bilibili.com/*"]);
    assert.strictEqual(granted, true);
    assert.deepStrictEqual(requestedOrigins, ["*://*.bilibili.com/*"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("getOptionalOriginsForUrl returns required origins for bilibili and youtube URLs", () => {
  assert.deepStrictEqual(
    getOptionalOriginsForUrl("https://www.bilibili.com/video/BV1xx411c7mD"),
    ["*://*.bilibili.com/*", "*://*.hdslb.com/*"],
  );
  assert.deepStrictEqual(
    getOptionalOriginsForUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    [
      "*://*.youtube.com/*",
      "*://*.googlevideo.com/*",
      "https://sponsor.ajay.app/*",
    ],
  );
  assert.deepStrictEqual(
    getOptionalOriginsForUrl("https://youtu.be/dQw4w9WgXcQ"),
    [
      "*://*.youtube.com/*",
      "*://*.googlevideo.com/*",
      "https://sponsor.ajay.app/*",
    ],
  );
  assert.deepStrictEqual(
    getOptionalOriginsForUrl("https://en.wikipedia.org/wiki/Main_Page"),
    [],
  );
});

test("ensurePermissionsForUrl requests permissions on-demand when not already granted", async () => {
  const originalChrome = globalThis.chrome;
  let requestedOrigins = null;

  globalThis.chrome = {
    permissions: {
      contains(_opts, callback) {
        callback(false);
      },
      request({ origins }, callback) {
        requestedOrigins = origins;
        callback(true);
      },
    },
  };

  try {
    const result = await ensurePermissionsForUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    assert.strictEqual(result, true);
    assert.deepStrictEqual(requestedOrigins, [
      "*://*.youtube.com/*",
      "*://*.googlevideo.com/*",
      "https://sponsor.ajay.app/*",
    ]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
