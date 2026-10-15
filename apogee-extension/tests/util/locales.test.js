import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkCatalogs } from "../../scripts/check-locales.mjs";

const REAL_LOCALES = new URL("../../_locales", import.meta.url);
const REAL_GLOSSARY = JSON.parse(
  readFileSync(
    new URL("../../_locales/glossary.json", import.meta.url),
    "utf8",
  ),
);

function writeCatalog(root, code, messages) {
  const dir = join(root, code);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "messages.json"), JSON.stringify(messages));
}

function enCatalog(overrides = {}) {
  return {
    settings: { message: "Settings" },
    settingsTitle: { message: "Settings" },
    cancel: { message: "Cancel" },
    ...overrides,
  };
}

function testGlossary() {
  return {
    defaultLocale: "en",
    terms: [
      { id: "settings", en: "Settings", keys: ["settings", "settingsTitle"] },
    ],
  };
}

function fixture({
  en = enCatalog(),
  locales = {},
  glossary = testGlossary(),
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "apogee-locales-"));
  writeCatalog(root, "en", en);
  for (const [code, messages] of Object.entries(locales)) {
    writeCatalog(root, code, messages);
  }
  return { root, glossary };
}

test("real catalogs pass: every locale defines every default key (#417)", () => {
  const localesDir = resolve(REAL_LOCALES.pathname);
  const { errors } = checkCatalogs(localesDir, REAL_GLOSSARY);
  assert.deepStrictEqual(errors, []);
});

test("real glossary terms match the default catalog verbatim (#417)", () => {
  for (const term of REAL_GLOSSARY.terms) {
    assert.ok(term.keys.length > 1, `${term.id} must share at least two keys`);
  }
});

test("locale missing a default-locale key fails (#417)", () => {
  const { root, glossary } = fixture({
    locales: { de: { settings: { message: "Einstellungen" } } },
  });
  const { errors } = checkCatalogs(root, glossary);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /locale "de" is missing .*settingsTitle/);
});

test("locale with empty message for a default key fails (#417)", () => {
  const { root, glossary } = fixture({
    locales: {
      de: {
        settings: { message: "Einstellungen" },
        settingsTitle: { message: "" },
        cancel: { message: "Abbrechen" },
      },
    },
  });
  const { errors } = checkCatalogs(root, glossary);
  assert.ok(
    errors.some((error) =>
      /locale "de" is missing .*settingsTitle/.test(error),
    ),
    `expected a missing-key error, got: ${errors.join("; ")}`,
  );
});

test("glossary drift in the default locale fails (#417)", () => {
  const { root, glossary } = fixture({
    en: enCatalog({ settingsTitle: { message: "Preferences" } }),
  });
  const { errors } = checkCatalogs(root, glossary);
  assert.ok(
    errors.some((error) => /glossary term "settings" drifts/.test(error)),
    `expected a glossary drift error, got: ${errors.join("; ")}`,
  );
});

test("glossary drift inside one locale fails while others pass (#417)", () => {
  const { root, glossary } = fixture({
    locales: {
      de: {
        settings: { message: "Einstellungen" },
        settingsTitle: { message: "Voreinstellungen" },
        cancel: { message: "Abbrechen" },
      },
    },
  });
  const { errors } = checkCatalogs(root, glossary);
  assert.ok(
    errors.some((error) =>
      /glossary term "settings" drifts in locale "de"/.test(error),
    ),
    `expected a per-locale drift error, got: ${errors.join("; ")}`,
  );
});

test("glossary term listing an unknown key fails (#417)", () => {
  const { root, glossary } = fixture({
    glossary: {
      terms: [{ id: "nope", en: "Nope", keys: ["doesNotExistKey"] }],
    },
  });
  const { errors } = checkCatalogs(root, glossary);
  assert.ok(
    errors.some((error) => /unknown default-locale key/.test(error)),
    `expected an unknown-key error, got: ${errors.join("; ")}`,
  );
});

test("extra locale-only keys warn but do not fail (#417)", () => {
  const { root, glossary } = fixture({
    locales: {
      de: {
        settings: { message: "Einstellungen" },
        settingsTitle: { message: "Einstellungen" },
        cancel: { message: "Abbrechen" },
        deOnly: { message: "Nur Deutsch" },
      },
    },
  });
  const { errors, warnings } = checkCatalogs(root, glossary);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /locale "de" defines 1 key\(s\) absent/);
});
