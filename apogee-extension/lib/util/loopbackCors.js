// Runtime session-rule scoping for loopback Origin stripping.
// Every supported browser (Chrome 116+, Firefox 140+) supports session-scoped
// declarativeNetRequest rules, so we do not ship a broad static fallback rule.
// Scoping the session rule to both this extension's own initiator domain and
// TAB_ID_NONE guarantees website requests (including website service workers
// and local dev servers) keep their Origin header and local CSRF defenses stay
// intact.

import { withTimeout } from "./withTimeout.js";

export const LOOPBACK_CORS_SESSION_RULE_ID = 1;

// TAB_ID_NONE literal so the builder works without the tabs permission.
export const TAB_ID_NONE = -1;

// Loopback hosts for the Origin-strip rule, in sync with ollamaHost.js.
// Bracketed IPv6 only: both runtimes match that form and Firefox rejects
// a bare ::1 domain at load.
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// Resolve this extension's own initiator domain for declarativeNetRequest
// initiatorDomains. Using runtime.getURL("") handles both Chromium
// (chrome-extension://<id>/) and Firefox (moz-extension://<uuid>/), whereas
// Firefox sets runtime.id to the add-on ID ("apogee@darshi.dev") rather than
// the moz-extension:// UUID host.
export function getExtensionInitiatorDomain() {
  if (typeof chrome === "undefined" || !chrome.runtime) return null;
  if (typeof chrome.runtime.getURL === "function") {
    try {
      const hostname = new URL(
        chrome.runtime.getURL(""),
      ).hostname.toLowerCase();
      if (hostname && !LOOPBACK_HOSTS.includes(hostname)) return hostname;
    } catch {
      // Fall through to runtime.id when getURL is a non-URL test stub.
    }
  }
  const id =
    typeof chrome.runtime.id === "string"
      ? chrome.runtime.id.trim().toLowerCase()
      : "";
  if (
    id &&
    /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(id) &&
    !LOOPBACK_HOSTS.includes(id)
  ) {
    return id;
  }
  return null;
}

export function buildLoopbackCorsSessionRule(
  initiatorDomain = getExtensionInitiatorDomain(),
) {
  const domain =
    typeof initiatorDomain === "string"
      ? initiatorDomain.trim().toLowerCase()
      : "";
  if (
    !domain ||
    !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(domain) ||
    LOOPBACK_HOSTS.includes(domain)
  ) {
    throw new Error(
      "Extension initiator domain is required for loopback CORS session rule",
    );
  }
  return {
    id: LOOPBACK_CORS_SESSION_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "remove" }],
    },
    condition: {
      requestDomains: [...LOOPBACK_HOSTS],
      initiatorDomains: [domain],
      excludedInitiatorDomains: [...LOOPBACK_HOSTS],
      resourceTypes: ["xmlhttprequest"],
      tabIds: [TAB_ID_NONE],
    },
  };
}

let ensurePromise = null;

// Register the extension-scoped, non-tab Origin-strip session rule. Cached, so
// repeat loopback calls pay a resolved promise. Resolves to "session" when the
// scoped rule is active, "unavailable" when updateSessionRules fails, and
// "unsupported" when declarativeNetRequest or extension identity is absent
// (unit tests). Fails closed with no broad static fallback. Never rejects.
export function ensureLoopbackCorsRule() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const dnr =
      typeof chrome !== "undefined" ? chrome.declarativeNetRequest : null;
    const initiatorDomain = getExtensionInitiatorDomain();
    if (!dnr?.updateSessionRules || !initiatorDomain) return "unsupported";
    try {
      await dnr.updateSessionRules({
        removeRuleIds: [LOOPBACK_CORS_SESSION_RULE_ID],
        addRules: [buildLoopbackCorsSessionRule(initiatorDomain)],
      });
    } catch {
      return "unavailable";
    }
    return "session";
  })();
  return ensurePromise;
}

export function resetLoopbackCorsRuleForTests() {
  ensurePromise = null;
}

// Same registration as ensureLoopbackCorsRule, but never blocks the first
// loopback request behind it: if the declarativeNetRequest handshake hangs
// (slow runtime, first-call jank), the fetch proceeds after `timeoutMs`
// instead of stalling indefinitely. Never rejects.
export function ensureLoopbackCorsRuleSoon(timeoutMs = 750) {
  return withTimeout(ensureLoopbackCorsRule(), timeoutMs, {
    onTimeout: () => "timeout",
  });
}
