import test from "node:test";
import assert from "node:assert";

import {
  unscriptableReason,
  injectionErrorMessage,
  isHostAccessDenied,
  resolveTabUrl,
  ensureTabUrl,
  extractFromActiveTab,
} from "../../lib/extract/pageExtraction.js";

test("browser-internal pages are rejected before injection", () => {
  for (const url of [
    "chrome://extensions",
    "about:addons",
    "edge://settings",
    "chrome-extension://abcdef/app.html",
  ]) {
    const reason = unscriptableReason(url);
    assert.match(reason, /Browser-internal pages/);
  }
});

test("withheld tab URLs pass pre-flight instead of misreading as internal", () => {
  // Firefox sidebar panels do not always see tab.url; a missing URL says
  // nothing about the page, so it must resolve from the tab itself.
  assert.equal(unscriptableReason(undefined), null);
  assert.equal(unscriptableReason(""), null);
  assert.equal(unscriptableReason(null), null);
});

test("gallery pages the browser refuses to script are rejected", () => {
  assert.match(
    unscriptableReason("https://chromewebstore.google.com/detail/apogee/abc"),
    /Chrome Web Store/,
  );
  assert.match(
    unscriptableReason("https://chrome.google.com/webstore/detail/apogee/abc"),
    /Chrome Web Store/,
  );
  assert.match(
    unscriptableReason(
      "https://addons.mozilla.org/en-US/firefox/addon/apogee/",
    ),
    /Firefox Add-ons/,
  );
  assert.match(
    unscriptableReason("https://accounts.firefox.com/signin"),
    /Firefox Accounts/,
  );
});

test("blocked hosts are matched exactly, not by suffix", () => {
  assert.equal(
    unscriptableReason("https://notchromewebstore.google.com/x"),
    null,
  );
  assert.equal(
    unscriptableReason("https://chrome.google.com/intl/en/chrome/"),
    null,
  );
});

test("ordinary pages pass the pre-flight check", () => {
  for (const url of [
    "https://example.com/article",
    "http://localhost:3000/",
    "file:///home/user/notes.html",
    "https://en.wikipedia.org/wiki/Apogee",
  ]) {
    assert.equal(unscriptableReason(url), null);
  }
});

test("raw injection failures are rewritten into a friendly message", () => {
  const friendly = /The browser blocks extensions from running here/;
  assert.match(
    injectionErrorMessage(
      new Error("The extensions gallery cannot be scripted."),
    ),
    friendly,
  );
  assert.match(
    injectionErrorMessage(new Error("Cannot access contents of the page.")),
    friendly,
  );
  assert.match(
    injectionErrorMessage(new Error("This page is blocked by policy")),
    friendly,
  );
});

test("unrelated injection failures keep their original message", () => {
  assert.equal(
    injectionErrorMessage(new Error("No tab with id: 42.")),
    "No tab with id: 42.",
  );
  assert.equal(injectionErrorMessage(null), "Apogee couldn't read this page.");
});

test("resolveTabUrl returns a known URL without scripting", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    scripting: {
      executeScript: async () => {
        throw new Error("must not script when the URL is known");
      },
    },
  };
  try {
    assert.equal(
      await resolveTabUrl({ id: 1, url: "https://example.com/a" }),
      "https://example.com/a",
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("resolveTabUrl asks the tab itself when the URL is withheld", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    scripting: {
      executeScript: async () => [{ result: "https://example.com/b" }],
    },
  };
  try {
    assert.equal(await resolveTabUrl({ id: 2 }), "https://example.com/b");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("resolveTabUrl returns null when the tab cannot be scripted", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    scripting: {
      executeScript: async () => {
        throw new Error("Cannot access contents of the page.");
      },
    },
  };
  try {
    assert.equal(await resolveTabUrl({ id: 3 }), null);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("ensureTabUrl fills in a missing tab URL in place", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    scripting: {
      executeScript: async () => [{ result: "https://example.com/c" }],
    },
  };
  try {
    const tab = { id: 4 };
    assert.equal(await ensureTabUrl(tab), "https://example.com/c");
    assert.equal(tab.url, "https://example.com/c");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("host-access denials are recognized on both browsers", () => {
  assert.equal(
    isHostAccessDenied(new Error("Missing host permission for the tab")),
    true,
  );
  assert.equal(
    isHostAccessDenied(
      new Error("Cannot access contents of url https://github.com/a"),
    ),
    true,
  );
  assert.equal(
    isHostAccessDenied(new Error("The extensions gallery cannot be scripted.")),
    false,
  );
  assert.equal(isHostAccessDenied(new Error("No tab with id: 42.")), false);
});

test("missing host permission maps to the friendly block message", () => {
  assert.match(
    injectionErrorMessage(new Error("Missing host permission for the tab")),
    /browser blocks extensions/,
  );
});

test("extraction retries once after a one-site grant", async () => {
  const originalChrome = globalThis.chrome;
  let injections = 0;
  const requested = [];
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "0.0.0-test" }) },
    scripting: {
      executeScript: async ({ func }) => {
        if (func) return [{ result: null }];
        injections += 1;
        if (injections === 1) {
          throw new Error("Missing host permission for the tab");
        }
        return [];
      },
    },
    permissions: {
      contains(_req, callback) {
        callback(false);
      },
      request({ origins }, callback) {
        requested.push(origins);
        callback(true);
      },
    },
    tabs: {
      sendMessage: async () => ({
        title: "t",
        url: "https://github.com/a/b",
        content: "hi",
      }),
    },
  };
  try {
    const pageData = await extractFromActiveTab({
      id: 7,
      url: "https://github.com/a/b",
    });
    assert.equal(pageData.content, "hi");
    assert.strictEqual(injections, 2);
    assert.deepStrictEqual(requested, [["*://github.com/*"]]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("extraction guides when the site grant is declined", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "0.0.0-test" }) },
    scripting: {
      executeScript: async ({ func }) => {
        if (func) return [{ result: null }];
        throw new Error("Missing host permission for the tab");
      },
    },
    permissions: {
      contains(_req, callback) {
        callback(false);
      },
      request(_req, callback) {
        callback(false);
      },
    },
    tabs: {
      sendMessage: async () => null,
    },
  };
  try {
    await assert.rejects(
      extractFromActiveTab({ id: 8, url: "https://github.com/a/b" }),
      /needs permission to read this site/,
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});
