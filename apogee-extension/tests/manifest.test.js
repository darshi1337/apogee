import test from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

test("manifest permissions exactly match the documented set (#182)", () => {
  // Every permission below is justified in PRIVACY.md ("Browser Permission
  // Sandboxing") and STORE-LISTING.md (permission justifications), including
  // unlimitedStorage for the cached model weights. Fail-closed exact match
  // so docs and manifest cannot drift apart again.
  assert.deepStrictEqual(
    new Set(manifest.permissions || []),
    new Set([
      "activeTab",
      "scripting",
      "storage",
      "unlimitedStorage",
      "offscreen",
      "sidePanel",
      "alarms",
      "contextMenus",
      "notifications",
      "declarativeNetRequestWithHostAccess",
    ]),
    "manifest permissions must exactly match the documented permission set",
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

test("declared network egress matches the documented allow-list (#180)", () => {
  // Every external host below is documented in PRIVACY.md ("Outbound Network
  // Connection Details") and README/STORE-LISTING permission justifications.
  // This test fails closed: adding a new egress host requires updating the
  // docs and this list together, so an undisclosed call like the former
  // api.github.com fetch cannot slip back in.
  const documentedConnectSrc = new Set([
    "'self'",
    "http://127.0.0.1:*",
    "http://localhost:*",
    "https://huggingface.co",
    "https://*.huggingface.co",
    "https://*.hf.co",
    "https://sponsor.ajay.app",
    "https://api.bilibili.com",
    "https://*.hdslb.com",
    "https://public.api.bsky.app",
  ]);

  const csp = manifest.content_security_policy?.extension_pages || "";
  const connectSrc = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src "));
  assert.ok(connectSrc, "extension_pages CSP must declare connect-src");
  const declared = connectSrc
    .replace(/^connect-src\s+/, "")
    .split(/\s+/)
    .filter(Boolean);
  assert.deepStrictEqual(
    new Set(declared),
    documentedConnectSrc,
    "connect-src must exactly match the documented egress allow-list",
  );

  assert.deepStrictEqual(
    new Set(manifest.host_permissions || []),
    new Set(["http://127.0.0.1/*", "http://localhost/*"]),
    "standing host_permissions must stay loopback-only",
  );
  assert.deepStrictEqual(
    new Set(manifest.optional_host_permissions || []),
    new Set([
      "*://*.bilibili.com/*",
      "*://*.hdslb.com/*",
      "*://*.youtube.com/*",
      "*://*.googlevideo.com/*",
      "*://*.bsky.app/*",
      "https://sponsor.ajay.app/*",
    ]),
    "optional_host_permissions must exactly match the documented set",
  );
});

test("extractor fetch hosts are declared and documented (#185)", () => {
  // The YouTube transcript fetch runs in the content script (page context),
  // so extension_pages connect-src does not bind it; what binds it is the
  // extractor's own host allow-list plus optional_host_permissions. Both
  // directions are pinned here: every host the extractor accepts must be
  // declared, and every declared pattern must be named in the docs.
  const youtubeSource = readFileSync(
    resolve(manifestPath.pathname, "..", "content/extractors/youtube.js"),
    "utf8",
  );
  const suffixDecl = youtubeSource.match(/allowedSuffixes\s*=\s*\[([^\]]*)\]/);
  assert.ok(suffixDecl, "youtube.js must declare allowedSuffixes");
  const suffixes = [...suffixDecl[1].matchAll(/"(\.[^"]+)"/g)].map((m) => m[1]);
  assert.ok(suffixes.length > 0, "allowedSuffixes must not be empty");

  const optional = new Set(manifest.optional_host_permissions || []);
  for (const suffix of suffixes) {
    const pattern = `*://*${suffix}/*`;
    assert.ok(
      optional.has(pattern),
      `extractor-accepted host ${suffix} must be declared as ${pattern}`,
    );
  }

  const docTokens = new Set();
  for (const doc of ["../../PRIVACY.md", "../../STORE-LISTING.md"]) {
    const text = readFileSync(new URL(doc, import.meta.url), "utf8");
    for (const [, token] of text.matchAll(/`([^`]+)`/g)) docTokens.add(token);
  }
  for (const pattern of optional) {
    assert.ok(
      docTokens.has(pattern),
      `declared permission ${pattern} must be named verbatim in PRIVACY.md or STORE-LISTING.md`,
    );
  }
});

test("every extractor fetch host is declared or same-origin-documented (#205)", () => {
  // Fail-closed parity: adding a new egress host to any content extractor
  // requires declaring it (connect-src / optional_host_permissions) and
  // documenting it, so an undisclosed call like the former api.github.com
  // fetch or the undocumented reddit .json fetch cannot slip back in.
  const extractorsDir = resolve(manifestPath.pathname, "..", "content/extractors");
  const csp = manifest.content_security_policy?.extension_pages || "";
  const connectSrc = (csp.split(";").map((p) => p.trim()).find((p) => p.startsWith("connect-src ")) || "")
    .replace(/^connect-src\s+/, "")
    .split(/\s+/)
    .filter(Boolean);
  const optional = [...(manifest.optional_host_permissions || [])];
  const coversHost = (host) => {
    const h = host.toLowerCase();
    for (const entry of connectSrc) {
      const e = entry.replace(/^https?:\/\//, "");
      if (e === h) return true;
      if (e.startsWith("*." ) && (h === e.slice(2) || h.endsWith(e.slice(1)))) return true;
    }
    for (const pattern of optional) {
      const m = pattern.match(/^\*:\/\/(\*\.|)([^/]+)\/\*$/);
      if (!m) continue;
      const base = m[2].toLowerCase();
      if (m[1] ? h === base || h.endsWith(`.${base}`) : h === base) return true;
    }
    return false;
  };

  const privacyText = readFileSync(new URL("../../PRIVACY.md", import.meta.url), "utf8");
  for (const file of readdirSync(extractorsDir).filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(resolve(extractorsDir, file), "utf8");
    if (!/\bfetch\s*\(/.test(source)) continue;
    // Absolute cross-origin targets must be declared; page-derived targets
    // (caption/track URLs validated against an allow-list, same-origin URLs
    // built from location.origin) are covered by the per-extractor docs.
    const absoluteHosts = new Set(
      [...source.matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1].toLowerCase()),
    );
    for (const host of absoluteHosts) {
      assert.ok(
        coversHost(host),
        `${file} fetches absolute host ${host} which must be declared in connect-src or optional_host_permissions`,
      );
    }
  }

  // The reddit .json fetch is same-origin page context: it must stay built
  // from location.origin (reaching no new host) and stay documented.
  const redditSource = readFileSync(resolve(extractorsDir, "reddit.js"), "utf8");
  assert.match(redditSource, /location\.origin/, "reddit.js .json fetch must stay same-origin (location.origin)");
  assert.match(privacyText, /Reddit Thread JSON/, "PRIVACY.md must document the reddit same-origin thread fetch");
});