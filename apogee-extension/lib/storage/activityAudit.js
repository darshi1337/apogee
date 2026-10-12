import { getSettings } from "./settings.js";
import { parsePrivateHosts, shouldPersist } from "./pageCache.js";

const AUDIT_LOG_KEY = "apogee_activity_audit_log";
const MAX_AUDIT_ENTRIES = 20;

// Record a page access for the transparency audit. Skips pages the user
// asked not to keep, so the log never becomes a backdoor history.
export async function recordPageAccessEvent({
  title,
  url,
  contentLength,
  type,
}) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  try {
    if (url && !(await shouldPersist(url))) return;
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
    // Audit logging must never break the page flow.
  }
}

export async function getPageAccessLog() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return [];
  try {
    const data = await chrome.storage.local.get([AUDIT_LOG_KEY]);
    return Array.isArray(data[AUDIT_LOG_KEY]) ? data[AUDIT_LOG_KEY] : [];
  } catch {
    return [];
  }
}

export async function getActivityAuditSummary() {
  const settings = await getSettings();
  const logs = await getPageAccessLog();

  let storageCount = 0;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      // Count via the order indexes instead of scanning the whole store.
      const [{ cacheOrder = [] }, { contentCacheOrder = [] }] =
        await Promise.all([
          chrome.storage.local.get("cacheOrder"),
          chrome.storage.local.get("contentCacheOrder"),
        ]);
      storageCount =
        cacheOrder.filter((e) => e?.s).length +
        cacheOrder.filter((e) => e?.p).length +
        contentCacheOrder.filter((k) => typeof k === "string").length;
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
      saveHistory: settings.saveHistory !== false,
      cachedPagesCount: storageCount,
      autoWipePrivateHosts: parsePrivateHosts(settings.privateHosts).length > 0,
      privateHostCount: parsePrivateHosts(settings.privateHosts).length,
    },
  };
}
