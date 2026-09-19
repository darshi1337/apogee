/**
 * Checks whether the extension currently has granted host permissions for the specified origins.
 * @param {string[]} origins List of origin match patterns (e.g. ["*://*.bilibili.com/*"])
 * @returns {Promise<boolean>}
 */
export async function hasHostPermissions(origins) {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
    return false;
  }
  try {
    return await new Promise((resolve) => {
      chrome.permissions.contains({ origins }, (result) => {
        resolve(Boolean(result));
      });
    });
  } catch {
    return false;
  }
}

/**
 * Requests host permissions on demand for the specified origins.
 * @param {string[]} origins List of origin match patterns
 * @returns {Promise<boolean>}
 */
export async function requestHostPermissions(origins) {
  if (typeof chrome === "undefined" || !chrome.permissions?.request) {
    // Fail closed like hasHostPermissions: without the permissions API there
    // is no prompt to grant, so callers must treat access as denied rather
    // than assuming the gated fetch is allowed.
    return false;
  }
  try {
    return await new Promise((resolve) => {
      chrome.permissions.request({ origins }, (granted) => {
        resolve(Boolean(granted));
      });
    });
  } catch {
    return false;
  }
}

/**
 * Maps a target URL to any optional host permissions it requires.
 * @param {string} url Target webpage URL
 * @returns {string[]} List of origin patterns required for full feature support on this domain
 */
export function getOptionalOriginsForUrl(url) {
  if (!url || typeof url !== "string") return [];
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "bilibili.com" || host.endsWith(".bilibili.com")) {
      return ["*://*.bilibili.com/*", "*://*.hdslb.com/*"];
    }
    if (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be"
    ) {
      return [
        "*://*.youtube.com/*",
        "*://*.googlevideo.com/*",
        "https://sponsor.ajay.app/*",
      ];
    }
    if (host === "bsky.app" || host.endsWith(".bsky.app")) {
      // Covers both the bsky.app page and the public.api.bsky.app thread
      // endpoint fetched by the Bluesky extractor. Without this mapping
      // getOptionalOriginsForUrl() returned [] for bsky.app, so the
      // on-demand permission prompt in ensurePermissionsForUrl() never fired.
      return ["*://*.bsky.app/*"];
    }
  } catch {}
  return [];
}

// Scoped origins for reading one site's content (`*://host/*`). Covered
// by the all-sites optional declaration, requested only after scripting
// proves the tab grant is gone (persistent surfaces like the side panel
// outlive activeTab). Never requested preemptively: popups covered by
// activeTab must not nag.
// @param {string} url Target webpage URL
// @returns {string[]} Single scoped pattern, or [] for non-web URLs
export function siteOriginsForUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return [];
    }
    if (!parsed.hostname) return [];
    return [`*://${parsed.hostname}/*`];
  } catch {
    return [];
  }
}

/**
 * Ask the user for one-site read access, fail-closed like the rest here.
 * Must run within the user gesture (called from the summarize click path).
 * @param {string} url Target webpage URL
 * @returns {Promise<boolean>} True when access is (now) granted
 */
export async function requestSiteAccess(url) {
  const origins = siteOriginsForUrl(url);
  if (origins.length === 0) return false;
  if (await hasHostPermissions(origins)) return true;
  return await requestHostPermissions(origins);
}

/**
 * Checks whether optional host permissions are needed for a URL, and if so, prompts the user to grant them.
 * @param {string} url Target webpage URL
 * @returns {Promise<boolean>} True if permissions are already granted or were successfully granted by the user.
 */
export async function ensurePermissionsForUrl(url) {
  const origins = getOptionalOriginsForUrl(url);
  if (origins.length === 0) return true;
  const granted = await hasHostPermissions(origins);
  if (granted) return true;
  return await requestHostPermissions(origins);
}
