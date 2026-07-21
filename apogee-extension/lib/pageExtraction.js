// Page-content and PDF-text extraction, shared by popup.js (UI-triggered
// summarize/ask) and background/service-worker.js (context-menu/keyboard-
// shortcut-triggered summarize, which runs with no popup open, see
// runBackgroundSummarize). Both functions are pure chrome.scripting/
// chrome.runtime calls with no dependency on popup-only state (unlike
// popup.js's getPageData, which layers in-memory reuse via currentPageData
// on top of extractFromActiveTab and stays in popup.js).

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
  return pageData || null;
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
