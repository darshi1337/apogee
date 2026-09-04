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
    return true;
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
  } catch {}
  return [];
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
