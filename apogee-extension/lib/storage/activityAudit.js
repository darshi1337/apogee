import { getSettings } from "./settings.js";

const AUDIT_LOG_KEY = "apogee_activity_audit_log";
const MAX_AUDIT_ENTRIES = 20;

/**
 * Record a page access event in local storage for transparency audit.
 * @param {{ title: string, url: string, contentLength: number, type: string }} event
 */
export async function recordPageAccessEvent({
  title,
  url,
  contentLength,
  type,
}) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get([AUDIT_LOG_KEY]);
    const logs = Array.isArray(data[AUDIT_LOG_KEY]) ? data[AUDIT_LOG_KEY] : [];
    const entry = {
      timestamp: new Date().toISOString(),
      title: title || "Untitled Page",
      url: url || "",
      contentLength: contentLength || 0,
      type: type || "generic",
    };
    const updated = [entry, ...logs].slice(0, MAX_AUDIT_ENTRIES);
    await chrome.storage.local.set({ [AUDIT_LOG_KEY]: updated });
  } catch {
    // Safe fallback: ignore audit logging error
  }
}

/**
 * Retrieve the page access audit log.
 * @returns {Promise<Array<{ timestamp: string, title: string, url: string, contentLength: number, type: string }>>}
 */
export async function getPageAccessLog() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return [];
  try {
    const data = await chrome.storage.local.get([AUDIT_LOG_KEY]);
    return Array.isArray(data[AUDIT_LOG_KEY]) ? data[AUDIT_LOG_KEY] : [];
  } catch {
    return [];
  }
}

/**
 * Get comprehensive Privacy & Activity audit summary.
 */
export async function getActivityAuditSummary() {
  const settings = await getSettings();
  const logs = await getPageAccessLog();

  let storageCount = 0;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const allData = await chrome.storage.local.get(null);
      storageCount = Object.keys(allData).filter(
        (k) => k.startsWith("summary_") || k.startsWith("cache_"),
      ).length;
    } catch {
      storageCount = 0;
    }
  }

  const sponsorBlockActive =
    settings.useSponsorBlock !== false && settings.useSponsorBlock !== "off";
  const externalRequestsAllowed = sponsorBlockActive;

  return {
    pageAccessCount: logs.length,
    recentAccesses: logs,
    networkEgress: {
      zeroEgress: !externalRequestsAllowed,
      sponsorBlockActive,
      statusMessage: !externalRequestsAllowed
        ? "0 external network requests (100% on-device local execution)"
        : "Local execution active (Optional SponsorBlock API enabled for video segment skipping)",
    },
    storageRetention: {
      saveHistory: settings.saveHistory !== "off",
      cachedPagesCount: storageCount,
      autoWipePrivateHosts: (settings.privateHosts || []).length > 0,
      privateHostCount: (settings.privateHosts || []).length,
    },
  };
}
