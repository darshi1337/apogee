// Page-content and PDF-text extraction, shared by popup.js (UI-triggered
// summarize/ask) and background/service-worker.js (context-menu/keyboard-
// shortcut-triggered summarize, which runs with no popup open, see
// runBackgroundSummarize). Both functions are pure chrome.scripting/
// chrome.runtime calls with no dependency on popup-only state (unlike
// popup.js's getPageData, which layers in-memory reuse via currentPageData
// on top of extractFromActiveTab and stays in popup.js).

import { getSettings } from "./settings.js";

// Injects the site-specific/generic extractors into the active tab and
// returns the extracted { title, url, content, type, isPdf } (or throws).
export async function extractFromActiveTab(tab) {
  const tabId = tab.id;

  // chrome://, edge://, about:, chrome-extension://, and similar
  // browser-internal pages are off-limits to extensions by design;
  // chrome.scripting.executeScript throws its own low-level "Cannot access
  // a chrome:// URL" style message for these, surface something a user can
  // actually act on instead of that raw error bubbling up as-is.
  if (!/^https?:|^file:/i.test(tab.url || "")) {
    throw new Error(
      "Apogee can't read this page. Browser-internal pages aren't accessible to extensions, try a regular webpage instead.",
    );
  }

  // Inject the extractors once per page, re-injecting when the injected copy
  // is from an older extension version, otherwise a tab left open across an
  // update keeps running the stale extractor until manually refreshed.
  const expectedVersion = chrome.runtime.getManifest().version;
  let injectedVersion = null;
  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        typeof window.extractPageContent === "function"
          ? window.__apogeeExtractorVersion || "unknown"
          : null,
    });
    injectedVersion = checkResult?.[0]?.result;
  } catch {}

  if (injectedVersion !== expectedVersion) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "/content/Readability.js",
        "/content/extractors/paywall.js",
        "/content/extractors/generic.js",
        "/content/extractors/youtube.js",
        "/content/extractors/gmail.js",
        "/content/content.js",
      ],
    });
    // Stamp the version so the check above can detect staleness next time.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (v) => {
        window.__apogeeExtractorVersion = v;
      },
      args: [expectedVersion],
    });
  }

  // Return the extractor's result directly. executeScript structured-clones
  // the return value, so there's no need to round-trip it through a DOM
  // attribute + JSON.parse (which also mutated the host page).
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        // extractPageContent() is async (YouTube's extractor fetches the
        // transcript), await it here so a rejection is caught below
        // instead of leaking an unhandled promise rejection past executeScript.
        return await window.extractPageContent();
      } catch (e) {
        return { error: e?.message || String(e) };
      }
    },
  });

  const pageData = results?.[0]?.result;
  if (pageData?.error) throw new Error(pageData.error);
  if (!pageData) return null;

  if (pageData.paywalled) {
    const settings = await getSettings();
    if (settings.archiveFallback) {
      const archived = await tryWaybackFallback(tabId);
      if (archived) {
        pageData.content = archived.content;
        if (archived.title) pageData.title = archived.title;
        pageData.archiveUrl = archived.archiveUrl;
      }
    }
  }

  return pageData;
}

// Looks up a Wayback Machine snapshot of the active tab's URL and, if one
// exists, extracts its article text the same way the live-page path does
// (Readability, already injected into the tab above). Runs inside the tab
// rather than here: the extension's own host_permissions/CSP only cover
// localhost + a few CDN hosts (see extractPdfContent's comment below for the
// same reasoning), archive.org is only ever granted as an optional
// permission requested from the Settings toggle (see popup.js), and only to
// the tab context, not extension pages. Returns null on any failure or if no
// snapshot exists - the caller falls back to whatever was already extracted
// from the live page, this never blocks summarization.
async function tryWaybackFallback(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      // Logged (not silently swallowed) since these failures are otherwise
      // invisible: this runs inside the tab, so check this page's own
      // DevTools console (not the popup's), not the extension's.
      try {
        const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(location.href)}`;
        const apiRes = await fetch(apiUrl);
        if (!apiRes.ok) {
          console.warn(
            `Apogee: Wayback availability lookup failed (${apiRes.status})`,
          );
          return null;
        }
        const apiData = await apiRes.json();
        const snapshot = apiData?.archived_snapshots?.closest;
        if (!snapshot?.available || !snapshot.timestamp) {
          console.warn("Apogee: no Wayback snapshot available for this page");
          return null;
        }

        const original = apiData.url || location.href;
        // The `id_` suffix returns the raw archived page without the
        // Wayback Machine's own toolbar/banner spliced in, closer to what
        // Readability would have seen on the original page.
        const rawUrl = `https://web.archive.org/web/${snapshot.timestamp}id_/${original}`;
        const htmlRes = await fetch(rawUrl);
        if (!htmlRes.ok) {
          console.warn(
            `Apogee: failed to fetch Wayback snapshot (${htmlRes.status})`,
          );
          return null;
        }
        const html = await htmlRes.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const article = new Readability(doc).parse();
        if (!article?.textContent) {
          console.warn(
            "Apogee: Readability couldn't parse the Wayback snapshot",
          );
          return null;
        }

        return {
          title: article.title,
          content: article.textContent,
          archiveUrl: `https://web.archive.org/web/${snapshot.timestamp}/${original}`,
        };
      } catch (e) {
        console.error("Apogee: Wayback fallback failed:", e);
        return null;
      }
    },
  });
  return results?.[0]?.result || null;
}

// Downloads the PDF and extracts its text, both client-side: the fetch runs
// inside the tab (via activeTab) since the extension's own CSP/host_permissions
// only allow localhost, then the bytes are handed to the service worker's
// "extract-pdf" handler (lib/pdfExtract.js), which needs a real page context
// for pdf.js's worker. Used for both providers now that summarization no
// longer routes through a backend that could fetch the PDF itself.
export async function extractPdfContent(tab) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const res = await fetch(window.location.href);
      if (!res.ok) throw new Error(`Failed to download PDF: ${res.status}`);
      return await res.arrayBuffer();
    },
  });
  const arrayBuffer = results?.[0]?.result;
  if (!arrayBuffer) throw new Error("Could not download PDF.");

  const response = await chrome.runtime.sendMessage({
    target: "service-worker",
    action: "extract-pdf",
    payload: { arrayBuffer },
  });
  return response?.text || "";
}
