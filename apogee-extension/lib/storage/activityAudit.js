import { getSettings } from "./settings.js";
import { getRemoteSettings } from "./remoteSettings.js";
import { parsePrivateHosts, shouldPersist } from "./pageCache.js";
import { REMOTE_PROVIDER_IDS } from "../engines/remoteModels.js";
import {
  hasRemoteCatalogPermissions,
  hasRemoteGenerationPermissions,
} from "../engines/remoteCredentials.js";

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
  const { providers } = await getRemoteSettings();
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
  const remoteCatalogConsented = REMOTE_PROVIDER_IDS.some(
    (provider) =>
      providers[provider]?.consent === true && providers[provider]?.hasApiKey,
  );
  const remoteGenerationConsented = REMOTE_PROVIDER_IDS.some(
    (provider) =>
      providers[provider]?.consent === true &&
      providers[provider]?.generationConsent === true &&
      providers[provider]?.hasApiKey,
  );
  // Consent can outlive the browser permission that makes the request
  // possible, so report what can actually reach the network.
  const [catalogAllowed, generationAllowed] = await Promise.all([
    remoteCatalogConsented
      ? hasRemoteCatalogPermissions().catch(() => false)
      : false,
    remoteGenerationConsented
      ? hasRemoteGenerationPermissions().catch(() => false)
      : false,
  ]);
  const remoteCatalogActive = remoteCatalogConsented && catalogAllowed;
  const remoteGenerationActive = remoteGenerationConsented && generationAllowed;
  const externalRequestsAllowed =
    sponsorBlockActive || remoteCatalogActive || remoteGenerationActive;

  return {
    pageAccessCount: logs.length,
    recentAccesses: logs,
    networkEgress: {
      zeroEgress: !externalRequestsAllowed,
      sponsorBlockActive,
      remoteCatalogActive,
      remoteGenerationActive,
      statusMessage: remoteGenerationActive
        ? `Opt-in remote generation + remote model catalog${sponsorBlockActive ? " + SponsorBlock API" : ""}`
        : remoteCatalogActive
          ? `Local inference + remote model catalog${sponsorBlockActive ? " + SponsorBlock API" : ""}`
          : !externalRequestsAllowed
            ? "100% local"
            : "Local + SponsorBlock API",
    },
    storageRetention: {
      saveHistory: settings.saveHistory !== false,
      cachedPagesCount: storageCount,
      autoWipePrivateHosts: parsePrivateHosts(settings.privateHosts).length > 0,
      privateHostCount: parsePrivateHosts(settings.privateHosts).length,
    },
  };
}
