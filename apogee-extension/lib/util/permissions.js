// One shared core for the check/request pair below. Fail closed:
// without the permissions API there is no prompt to grant, so callers
// treat access as denied.
import { UserFacingError } from "./userError.js";
import { tryParseUrl } from "./url.js";
async function queryPermissionsApi(method, origins) {
  if (
    typeof chrome === "undefined" ||
    typeof chrome.permissions?.[method] !== "function"
  ) {
    return false;
  }
  try {
    return await new Promise((resolve) => {
      chrome.permissions[method]({ origins }, (result) => {
        resolve(Boolean(result));
      });
    });
  } catch {
    return false;
  }
}

export async function hasHostPermissions(origins) {
  return queryPermissionsApi("contains", origins);
}

export async function requestHostPermissions(origins) {
  return queryPermissionsApi("request", origins);
}

// Which optional host permissions a URL needs, if any.
export function getOptionalOriginsForUrl(url) {
  if (!url || typeof url !== "string") return [];
  const parsed = tryParseUrl(url);
  if (parsed) {
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
      // Covers page plus API thread endpoint; without it the prompt never fired.
      return ["*://*.bsky.app/*"];
    }
  }
  return [];
}

// Scoped origins for reading one site (`*://host/*`). Requested only
// after scripting proves the tab grant is gone; never preemptively,
// so popups covered by activeTab do not nag.
export function siteOriginsForUrl(url) {
  const parsed = tryParseUrl(url);
  if (!parsed) return [];
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return [];
  }
  if (!parsed.hostname) return [];
  return [`*://${parsed.hostname}/*`];
}

// Ask for one-site read access. Fail closed, and call from the user
// gesture so the browser prompt is allowed.
export async function requestSiteAccess(url) {
  const origins = siteOriginsForUrl(url);
  if (origins.length === 0) return false;
  if (await hasHostPermissions(origins)) return true;
  return await requestHostPermissions(origins);
}

// Blocked-permission message naming the host and the button that re-prompts.
// Call from the click gesture so the request is allowed.
export function permissionBlockedMessage(url) {
  const host = tryParseUrl(url)?.hostname || "";
  const where = host ? ` ${host}` : " this site";
  return `Apogee needs permission to read${where}. Click Summarize again and choose Allow when the browser asks.`;
}

export async function ensurePermissionsForUrl(url) {
  const origins = getOptionalOriginsForUrl(url);
  if (origins.length === 0) return true;
  const granted = await hasHostPermissions(origins);
  if (granted) return true;
  return await requestHostPermissions(origins);
}

// Same gate, but throws the blocked message instead of returning false,
// so denied callers cannot fall through to extraction (#304).
export async function ensurePermissionsOrThrow(url) {
  if (await ensurePermissionsForUrl(url)) return;
  throw new UserFacingError(permissionBlockedMessage(url));
}
