/**
 * Scoping for the loopback Origin-strip rule (see rules/ollama-cors.json).
 *
 * A static declarativeNetRequest rule cannot express "only the extension's own
 * requests": initiatorDomains would need the install-specific extension id, and
 * the tabIds condition is only supported for session-scoped rules. The bundled
 * static rule therefore stays broad (loopback request hosts, loopback
 * initiators excluded) as a fallback for runtimes without session-rule
 * support, while this module registers an equivalent rule scoped to requests
 * that originate from no tab at all (chrome.tabs.TAB_ID_NONE). Extension
 * background, offscreen, and popup fetches to Ollama/llama.cpp carry no tab
 * id, but every website fetch does, so site pages keep their Origin header and
 * the CSRF defenses of other local services stay intact.
 */

export const LOOPBACK_CORS_STATIC_RULE_ID = 1;

export const LOOPBACK_CORS_SESSION_RULE_ID = 1;

// Literal for chrome.tabs.TAB_ID_NONE so the rule builder works without the tabs permission.
export const TAB_ID_NONE = -1;

export function buildLoopbackCorsSessionRule() {
  return {
    id: LOOPBACK_CORS_SESSION_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "remove" }],
    },
    condition: {
      requestDomains: ["localhost", "127.0.0.1"],
      excludedInitiatorDomains: ["localhost", "127.0.0.1"],
      resourceTypes: ["xmlhttprequest"],
      tabIds: [TAB_ID_NONE],
    },
  };
}

let ensurePromise = null;

/**
 * Register the non-tab-scoped Origin-strip session rule and, where the
 * platform allows it, disable the broad static fallback. Cached, so repeat
 * loopback calls pay a resolved promise. Resolves to "session" when the
 * scoped rule is active, "static-fallback" when only the bundled rule applies,
 * and "unsupported" when declarativeNetRequest is unavailable (unit tests).
 * Never rejects.
 */
export function ensureLoopbackCorsRule() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const dnr =
      typeof chrome !== "undefined" ? chrome.declarativeNetRequest : null;
    if (!dnr?.updateSessionRules) return "unsupported";
    try {
      await dnr.updateSessionRules({
        removeRuleIds: [LOOPBACK_CORS_SESSION_RULE_ID],
        addRules: [buildLoopbackCorsSessionRule()],
      });
    } catch {
      return "static-fallback";
    }
    try {
      await dnr.updateStaticRules?.({
        disableRuleIds: [LOOPBACK_CORS_STATIC_RULE_ID],
      });
    } catch {
      // Safe fallback: the broad static rule stays enabled, same as before this change
    }
    return "session";
  })();
  return ensurePromise;
}

/** Test-only reset for the cached registration promise. */
export function resetLoopbackCorsRuleForTests() {
  ensurePromise = null;
}
