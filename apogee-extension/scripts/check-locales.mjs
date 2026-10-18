import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_LOCALE = "en";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read ${path}: ${err.message}`, { cause: err });
  }
}

function messageOf(catalog, key) {
  const entry = catalog?.[key];
  return typeof entry?.message === "string" ? entry.message : undefined;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function keysWithoutMessage(catalog, keys) {
  return keys.filter((key) => !messageOf(catalog, key));
}

function checkDefaultCatalog(defaults) {
  const errors = [];
  const keys = Object.keys(defaults);
  if (keys.length === 0) {
    errors.push(`default locale "${DEFAULT_LOCALE}" defines no keys`);
  }
  for (const key of keysWithoutMessage(defaults, keys)) {
    errors.push(
      `default locale "${DEFAULT_LOCALE}" key "${key}" must have a non-empty message string`,
    );
  }
  return { errors, keys };
}

function checkLocaleCatalog(code, catalog, defaultKeys) {
  const errors = [];
  const warnings = [];
  const missing = keysWithoutMessage(catalog, defaultKeys);
  if (missing.length > 0) {
    errors.push(
      `locale "${code}" is missing ${missing.length} default-locale key(s): ${missing.join(", ")}`,
    );
  }
  const extra = Object.keys(catalog).filter(
    (key) => !defaultKeys.includes(key),
  );
  if (extra.length > 0) {
    warnings.push(
      `locale "${code}" defines ${extra.length} key(s) absent from the default locale: ${extra.join(", ")}`,
    );
  }
  return { errors, warnings };
}

function checkTermShape(term, seen) {
  const errors = [];
  if (!term || typeof term !== "object") {
    return { errors: ["glossary terms must be objects"], usable: false };
  }
  if (!isNonEmptyString(term.id)) {
    errors.push("glossary terms must have a non-empty string id");
    return { errors, usable: false };
  }
  if (seen.has(term.id)) {
    errors.push(`glossary term "${term.id}" is defined more than once`);
  }
  seen.add(term.id);
  if (!isNonEmptyString(term.en)) {
    errors.push(
      `glossary term "${term.id}" must have a non-empty canonical "en" text`,
    );
  }
  if (
    !Array.isArray(term.keys) ||
    term.keys.length === 0 ||
    term.keys.some((key) => !isNonEmptyString(key))
  ) {
    errors.push(
      `glossary term "${term.id}" must list a non-empty array of catalog key strings`,
    );
    return { errors, usable: false };
  }
  return { errors, usable: errors.length === 0 };
}

function summarizeRenderings(pairs) {
  return pairs
    .map(([key, text]) => `${key}=${JSON.stringify(text)}`)
    .join(", ");
}

function checkTermDrift(term, defaults, catalogs) {
  const errors = [];
  const unknown = term.keys.filter((key) => !(key in defaults));
  if (unknown.length > 0) {
    errors.push(
      `glossary term "${term.id}" lists unknown default-locale key(s): ${unknown.join(", ")}`,
    );
  }
  const known = term.keys.filter((key) => key in defaults);
  const enTexts = known.map((key) => [key, messageOf(defaults, key)]);
  if (!enTexts.every(([, text]) => text === term.en)) {
    errors.push(
      `glossary term "${term.id}" drifts in the default locale (expected ${JSON.stringify(term.en)}): ${summarizeRenderings(enTexts)}`,
    );
  }
  for (const [code, catalog] of Object.entries(catalogs)) {
    const present = known
      .map((key) => [key, messageOf(catalog, key)])
      .filter(([, text]) => text);
    if (new Set(present.map(([, text]) => text)).size > 1) {
      errors.push(
        `glossary term "${term.id}" drifts in locale "${code}" (one shared rendering per term): ${summarizeRenderings(present)}`,
      );
    }
  }
  return errors;
}

function checkGlossary(glossary, defaults, catalogs) {
  if (!glossary || typeof glossary !== "object" || Array.isArray(glossary)) {
    return ["glossary must be a JSON object with a terms array"];
  }
  if (!Array.isArray(glossary.terms) || glossary.terms.length === 0) {
    return ["glossary must define a non-empty terms array"];
  }
  const errors = [];
  const seen = new Set();
  for (const term of glossary.terms) {
    const shape = checkTermShape(term, seen);
    errors.push(...shape.errors);
    if (shape.usable) errors.push(...checkTermDrift(term, defaults, catalogs));
  }
  return errors;
}

export function checkCatalogs(localesDir, glossary) {
  const errors = [];
  const warnings = [];
  let entries;
  try {
    entries = readdirSync(localesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    return { errors: [`Cannot list ${localesDir}: ${err.message}`], warnings };
  }
  if (!entries.includes(DEFAULT_LOCALE)) {
    errors.push(
      `default locale "${DEFAULT_LOCALE}" is missing from ${localesDir}`,
    );
    return { errors, warnings };
  }
  const defaults = readJson(
    resolve(localesDir, DEFAULT_LOCALE, "messages.json"),
  );
  const defaultCheck = checkDefaultCatalog(defaults);
  errors.push(...defaultCheck.errors);

  const catalogs = {};
  for (const code of entries) {
    if (code === DEFAULT_LOCALE) continue;
    const catalog = readJson(resolve(localesDir, code, "messages.json"));
    catalogs[code] = catalog;
    const result = checkLocaleCatalog(code, catalog, defaultCheck.keys);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  errors.push(...checkGlossary(glossary, defaults, catalogs));
  return { errors, warnings };
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function main() {
  const localesDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "_locales",
  );
  let glossary;
  let result;
  try {
    glossary = readJson(resolve(localesDir, "glossary.json"));
    result = checkCatalogs(localesDir, glossary);
  } catch (err) {
    fail(err.message);
  }
  for (const warning of result.warnings) console.log(`::warning::${warning}`);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`::error::${error}`);
    console.error(
      `locale catalog check failed with ${result.errors.length} error(s)`,
    );
    process.exit(1);
  }
  console.log("locale catalogs OK: every locale defines every default key");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
