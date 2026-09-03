import test from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = new URL("../manifest.json", import.meta.url);
const manifestRaw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

test("manifest.json conforms to Manifest V3 requirements", () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.name, "Apogee");
  assert.ok(manifest.version, "Manifest must have a version property");
  assert.ok(manifest.description, "Manifest must have a description");
});

test("manifest.json declares valid background service worker", () => {
  assert.ok(manifest.background, "Manifest must declare a background script");
  assert.strictEqual(
    manifest.background.service_worker,
    "background/service-worker.js",
  );
  assert.strictEqual(manifest.background.type, "module");
  assert.ok(
    existsSync(
      resolve(manifestPath.pathname, "../background/service-worker.js"),
    ),
    "Background service worker file must exist",
  );
});

test("manifest.json exposes the popup UI as a Chrome side panel", () => {
  assert.ok(
    Number(manifest.minimum_chrome_version) >= 116,
    "Programmatic side panel opening requires Chrome 116 or newer",
  );
  assert.ok(
    manifest.permissions.includes("sidePanel"),
    "Manifest must declare the sidePanel permission",
  );
  assert.strictEqual(
    manifest.side_panel?.default_path,
    "ui/app.html?surface=side-panel",
  );
  assert.strictEqual(manifest.action?.default_popup, "ui/app.html");
});

test("manifest.json permissions enforce local-first privacy boundary", () => {
  const permissions = manifest.permissions || [];
  const hostPermissions = manifest.host_permissions || [];
  const optionalHostPermissions = manifest.optional_host_permissions || [];

  assert.ok(
    permissions.includes("storage"),
    "Manifest must declare storage permission",
  );
  assert.ok(
    permissions.includes("unlimitedStorage"),
    "Manifest must declare unlimitedStorage for cached summaries and page text",
  );
  assert.ok(
    permissions.includes("activeTab"),
    "Manifest must declare activeTab permission",
  );

  // Enforce no <all_urls> standing host permissions
  assert.strictEqual(
    hostPermissions.includes("<all_urls>"),
    false,
    "Standing host_permissions must not contain <all_urls>",
  );

  // Enforce standing host permissions restricted to local loopback
  hostPermissions.forEach((host) => {
    assert.ok(
      host.startsWith("http://127.0.0.1") ||
        host.startsWith("http://localhost"),
      `Standing host permission ${host} must be restricted to loopback addresses`,
    );
  });

  // Verify site-specific cross-origin hosts are declared in optional_host_permissions
  assert.ok(
    optionalHostPermissions.includes("*://*.youtube.com/*"),
    "YouTube host permission must be optional",
  );
  assert.ok(
    optionalHostPermissions.includes("*://*.bilibili.com/*"),
    "Bilibili host permission must be optional",
  );
  assert.ok(
    optionalHostPermissions.includes("https://sponsor.ajay.app/*"),
    "SponsorBlock host permission must be optional",
  );
});

test("declarativeNetRequest rule files exist and parse as valid JSON", () => {
  assert.ok(
    manifest.declarative_net_request,
    "Declarative net request must be declared",
  );
  const ruleResources = manifest.declarative_net_request.rule_resources || [];
  assert.ok(
    ruleResources.length > 0,
    "At least one rule resource must be configured",
  );

  ruleResources.forEach((resource) => {
    const ruleFilePath = resolve(manifestPath.pathname, "..", resource.path);
    assert.ok(
      existsSync(ruleFilePath),
      `Rule file ${resource.path} must exist`,
    );
    const ruleContent = readFileSync(ruleFilePath, "utf8");
    const rules = JSON.parse(ruleContent);
    assert.ok(Array.isArray(rules), "Rule file content must be a JSON array");
  });
});
