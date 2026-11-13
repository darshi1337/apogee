import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { functionBody } from "../helpers/readSource.js";

import { t, applyI18nToDom } from "../../lib/util/i18n.js";

const messages = JSON.parse(
  readFileSync(
    new URL("../../_locales/en/messages.json", import.meta.url),
    "utf8",
  ),
);
const manifest = JSON.parse(
  readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"),
);
const appHtml = readFileSync(
  new URL("../../ui/app.html", import.meta.url),
  "utf8",
);

const appSource = readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf8",
);

test("manifest declares default_locale matching _locales (#247)", () => {
  assert.strictEqual(manifest.default_locale, "en");
  assert.ok(messages.appName, "en messages must define appName");
});

test("en messages.json entries have non-empty message strings", () => {
  const keys = Object.keys(messages);
  assert.ok(keys.length > 50, `expected 50+ keys, got ${keys.length}`);
  for (const [key, entry] of Object.entries(messages)) {
    assert.strictEqual(
      typeof entry.message,
      "string",
      `${key} must have a message string`,
    );
    assert.ok(entry.message.length > 0, `${key} message must not be empty`);
  }
});

test("t() falls back to English when chrome.i18n is absent", () => {
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  try {
    assert.strictEqual(t("summarizeThisPage"), "Summarize this page");
    assert.strictEqual(t("cancel"), "Cancel");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("t() prefers chrome.i18n.getMessage when available", () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    i18n: { getMessage: (key) => (key === "cancel" ? "Anuluj" : "") },
  };
  try {
    assert.strictEqual(t("cancel"), "Anuluj");
    assert.strictEqual(t("summarizeThisPage"), "Summarize this page");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("t() returns the key for unknown entries", () => {
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  try {
    assert.strictEqual(t("doesNotExistKey"), "doesNotExistKey");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("every data-i18n key in app.html exists in en messages", () => {
  const keys = new Set(
    [
      ...appHtml.matchAll(
        /data-i18n(?:-aria-label|-title|-placeholder|-alt|-content)?="([^"]+)"/g,
      ),
    ].map((m) => m[1]),
  );
  assert.ok(
    keys.size > 50,
    `expected 50+ i18n keys in app.html, got ${keys.size}`,
  );
  const missing = [...keys].filter((k) => !messages[k]);
  assert.deepStrictEqual(
    missing,
    [],
    `missing en messages: ${missing.join(", ")}`,
  );
});

test("applyI18nToDom hydrates data-i18n nodes without chrome.i18n", () => {
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  try {
    const els = [];
    const root = {
      documentElement: { lang: "en" },
      querySelectorAll(selector) {
        const attr = selector.slice(1, -1);
        return els.filter((el) => el.attrs[attr] !== undefined);
      },
    };
    const makeEl = (attrs, text = "") => {
      const el = {
        attrs,
        textContent: text,
        getAttribute: (n) => attrs[n],
        setAttribute: (n, v) => {
          el.attrs[n] = v;
        },
      };
      els.push(el);
      return el;
    };
    const title = makeEl(
      { "data-i18n": "summarizeThisPage" },
      "Summarize this page",
    );
    const btn = makeEl({ "data-i18n-aria-label": "send" });
    const count = applyI18nToDom(root);
    assert.strictEqual(title.textContent, "Summarize this page");
    assert.strictEqual(btn.attrs["aria-label"], "Send");
    assert.ok(count >= 2);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("dynamic popup messages reference existing catalog keys (#641)", () => {
  const keys = [...appSource.matchAll(/\bt\(\s*"([^"]+)"/g)].map(
    ([, key]) => key,
  );
  const progressKeys = appSource.match(
    /const SUMMARIZE_VERB_KEYS = \[([\s\S]*?)\];/,
  )?.[1];
  assert.ok(progressKeys, "summary progress has a list of locale keys");
  keys.push(...[...progressKeys.matchAll(/"([^"]+)"/g)].map(([, key]) => key));

  for (const mapName of ["AUDIT_EGRESS_KEYS", "AUDIT_TYPE_KEYS"]) {
    const mapBody = appSource.match(
      new RegExp(`const ${mapName} = \\{([\\s\\S]*?)\\};`),
    )?.[1];
    assert.ok(mapBody, `${mapName} must be defined in app.js`);
    keys.push(...[...mapBody.matchAll(/:\s*"([^"]+)"/g)].map(([, key]) => key));
  }
  assert.deepStrictEqual(
    [...new Set(keys)].filter((key) => !messages[key]?.message),
    [],
  );
});

test("dynamic popup messages substitute values in the English fallback (#641)", () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { i18n: { getMessage: () => "" } };
  try {
    assert.strictEqual(
      t("auditAccessDetails", ["article", "1200", "12:30"]),
      "article • 1200 chars • 12:30",
    );
    assert.strictEqual(t("llamaModelsAvailable", "2"), "2 models available.");
    assert.strictEqual(
      t("fetchLogsFailed", ["unexpected $DETAIL$"]),
      "Error fetching logs: unexpected $DETAIL$",
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("cancel control uses locale text when shown and clicked (#641)", () => {
  const body = functionBody(
    appSource,
    "createCancelControl",
    "const summaryCancel",
  );
  let activeId;
  let click;
  const cancelled = [];
  const button = {
    classList: { remove() {} },
    addEventListener(type, listener) {
      assert.strictEqual(type, "click");
      click = listener;
    },
  };
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    i18n: {
      getMessage: (key) =>
        ({ cancel: "Annuler", cancelling: "Annulation..." })[key],
    },
  };
  try {
    const createControl = runInNewContext(
      "(function (btn, getActiveId, setActiveId) {" + body + "\n})",
      { t, cancelStream: (streamId) => cancelled.push(streamId) },
    );
    const control = createControl(
      button,
      () => activeId,
      (id) => {
        activeId = id;
      },
    );

    control.show("stream-1");
    assert.strictEqual(button.textContent, "Annuler");
    assert.strictEqual(button.disabled, false);

    click();
    assert.strictEqual(button.textContent, "Annulation...");
    assert.strictEqual(button.disabled, true);
    assert.deepStrictEqual(cancelled, ["stream-1"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
