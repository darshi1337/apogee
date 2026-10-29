import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(message) {
  errors.push(message);
  console.error(`::error::${message}`);
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkVersions() {
  const rootVersion = readJson("package.json").version;
  const extensionVersion = readJson("apogee-extension/package.json").version;
  const manifestVersion = readJson("apogee-extension/manifest.json").version;
  const pinnedVersion = readJson(".release-please-manifest.json")["."];

  const versions = {
    "package.json": rootVersion,
    "apogee-extension/package.json": extensionVersion,
    "apogee-extension/manifest.json": manifestVersion,
    ".release-please-manifest.json": pinnedVersion,
  };

  for (const [file, version] of Object.entries(versions)) {
    if (version !== rootVersion) {
      fail(`${file} version ${version} must match package.json ${rootVersion}`);
    }
  }

  return { rootVersion, manifestVersion };
}

function checkReleaseBadge(rootVersion) {
  const badge = read(".github/assets/badge-release.svg");
  const pattern = new RegExp(`v${escapeRegExp(rootVersion)}(?![0-9.])`, "g");
  const matches = badge.match(pattern) || [];
  if (matches.length !== 5) {
    fail(
      "release badge must show the package version in aria-label, title, and 3 text nodes",
    );
  }
}

function checkStoreListing(manifestVersion) {
  const listing = read("STORE-LISTING.md");
  const stamp = `Version at last edit: ${manifestVersion}`;
  if (!listing.includes(stamp)) {
    fail(`STORE-LISTING.md stamp must say '${stamp}'`);
  }
}

function checkStoreAssets() {
  const assets = [
    ".github/assets/apogee-deck-1280x800-1.png",
    ".github/assets/apogee-deck-1280x800-2.png",
    ".github/assets/apogee-deck-1280x800-3.png",
    ".github/assets/apogee-deck-1280x800-4.png",
    ".github/assets/apogee-deck-1280x800-5.png",
    ".github/assets/apogee-deck-2400x1800-1.png",
    ".github/assets/apogee-deck-2400x1800-2.png",
    ".github/assets/apogee-deck-2400x1800-3.png",
    ".github/assets/apogee-deck-2400x1800-4.png",
    ".github/assets/apogee-deck-2400x1800-5.png",
    ".github/assets/apogee-promo-tile-440x280.png",
    ".github/assets/apogee-marquee-1400x560.png",
    "apogee-extension/assets/icon-16.png",
    "apogee-extension/assets/icon-32.png",
    "apogee-extension/assets/icon-48.png",
    "apogee-extension/assets/icon-96.png",
    "apogee-extension/assets/icon.png",
  ];

  for (const asset of assets) {
    const path = join(root, asset);
    if (!existsSync(path) || statSync(path).size === 0) {
      fail(`missing or empty: ${asset}`);
    }
  }
}

function checkPermissionsDocs() {
  const manifest = readJson("apogee-extension/manifest.json");
  const docs = {
    "PRIVACY.md": read("PRIVACY.md"),
    "STORE-LISTING.md": read("STORE-LISTING.md"),
  };
  const keys = [
    "permissions",
    "optional_permissions",
    "host_permissions",
    "optional_host_permissions",
  ];

  for (const key of keys) {
    for (const permission of manifest[key] || []) {
      for (const [file, text] of Object.entries(docs)) {
        if (!text.includes(permission)) {
          fail(`${key} entry "${permission}" not mentioned in ${file}`);
        }
      }
    }
  }
}

const { rootVersion, manifestVersion } = checkVersions();
checkReleaseBadge(rootVersion);
checkStoreListing(manifestVersion);
checkStoreAssets();
checkPermissionsDocs();

if (errors.length > 0) {
  console.error(`consistency checks failed with ${errors.length} error(s)`);
  process.exit(1);
}

console.log("consistency checks passed");
