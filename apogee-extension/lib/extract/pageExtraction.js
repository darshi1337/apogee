import { UserFacingError } from "../util/userError.js";
import { requestSiteAccess } from "../util/permissions.js";
import { MAX_UPLOAD_FILE_BYTES } from "./fileLimits.js";

// Pages the browser itself refuses to let extensions script, even though they are ordinary https URLs. Without this the raw engine error ("The extensions gallery cannot be scripted.") leaks into the popup.
const BLOCKED_PAGES = [
  { host: "chromewebstore.google.com", label: "the Chrome Web Store" },
  {
    host: "chrome.google.com",
    path: "/webstore",
    label: "the Chrome Web Store",
  },
  { host: "addons.mozilla.org", label: "Firefox Add-ons" },
  { host: "accounts.firefox.com", label: "Firefox Accounts" },
];

export function unscriptableReason(url) {
  // A missing URL means the browser withheld it (Firefox sidebar panels do
  // not always see tab.url). That says nothing about the page itself, so
  // pass pre-flight and let the tab resolve (or fail) on its own below.
  if (url == null || url === "") return null;
  if (!/^https?:|^file:/i.test(url)) {
    return "Apogee can't read this page. Browser-internal pages aren't accessible to extensions, try a regular webpage instead.";
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const blocked = BLOCKED_PAGES.find(
    (page) =>
      page.host === hostname &&
      (!page.path || parsed.pathname.startsWith(page.path)),
  );
  if (!blocked) return null;

  return `Apogee can't read ${blocked.label}. Browsers block extensions from running on this page, try a regular webpage instead.`;
}

// Ask the tab itself for its URL. Needed where the browser withholds
// tab.url from the extension page (Firefox sidebar), while scripting by
// tab id still works. Returns null when the page cannot be scripted.
export async function resolveTabUrl(tab) {
  if (tab?.url) return tab.url;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.location.href,
    });
    return typeof result?.result === "string" ? result.result : null;
  } catch {
    return null;
  }
}

// Fill in a missing tab.url in place so cache keys, view state, and
// persistence downstream all see the real address. Returns the URL.
export async function ensureTabUrl(tab) {
  if (tab?.url) return tab.url;
  const resolved = await resolveTabUrl(tab);
  if (resolved) tab.url = resolved;
  return tab.url || null;
}

// Fallback for pages the blocklist above doesn't know about (enterprise policy blocks, other builtin galleries) so the browser's own wording never surfaces.
export function injectionErrorMessage(err) {
  const raw = err?.message || String(err || "");
  if (
    /cannot be scripted|cannot access|blocked|not allowed|denied|missing host permission/i.test(
      raw,
    )
  ) {
    return "Apogee can't read this page. The browser blocks extensions from running here, try a regular webpage instead.";
  }
  return raw || "Apogee couldn't read this page.";
}

// True for failures a user grant can fix (expired tab grant on persistent
// surfaces): Chrome's "Cannot access contents of url…" and Firefox's
// "Missing host permission for the tab". Store/gallery blocks stay out:
// no grant can ever fix those.
export function isHostAccessDenied(err) {
  const raw = err?.message || String(err || "");
  return /missing host permission|cannot access contents/i.test(raw);
}

async function injectExtractors(tabId, expectedVersion) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "/content/Readability.js",
      "/content/extractors/generic.js",
      "/content/extractors/youtube.js",
      "/content/extractors/bilibili.js",
      "/content/extractors/gmail.js",
      "/content/extractors/thread.js",
      "/content/extractors/hackernews.js",
      "/content/extractors/reddit.js",
      "/content/extractors/lobsters.js",
      "/content/extractors/github.js",
      "/content/extractors/gitlab.js",
      "/content/extractors/wikipedia.js",
      "/content/extractors/arxiv.js",
      "/content/extractors/mastodon.js",
      "/content/extractors/stackoverflow.js",
      "/content/extractors/lemmy.js",
      "/content/extractors/discourse.js",
      "/content/extractors/devto.js",
      "/content/extractors/bluesky.js",
      "/content/content.js",
    ],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (v) => {
      window.__apogeeExtractorVersion = v;
    },
    args: [expectedVersion],
  });
}

export async function extractFromActiveTab(tab) {
  const tabId = tab.id;

  const url = tab.url || (await resolveTabUrl(tab));
  const blockedReason = unscriptableReason(url);
  if (blockedReason) throw new UserFacingError(blockedReason);
  if (!url) {
    throw new UserFacingError(
      "Apogee couldn't access this tab. Try reloading the page.",
    );
  }
  if (!tab.url) tab.url = url;

  const expectedVersion = chrome.runtime.getManifest().version;
  let injectedVersion = null;
  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        typeof window.__apogeeExtractorVersion === "string"
          ? window.__apogeeExtractorVersion
          : null,
    });
    injectedVersion = checkResult?.[0]?.result;
  } catch {}

  if (injectedVersion !== expectedVersion) {
    try {
      await injectExtractors(tabId, expectedVersion);
    } catch (e) {
      // Persistent surfaces (side panel) outlive the temporary tab grant:
      // ask for one-site access and retry once before giving up.
      if (url && isHostAccessDenied(e) && (await requestSiteAccess(url))) {
        try {
          await injectExtractors(tabId, expectedVersion);
        } catch (retryError) {
          throw new UserFacingError(injectionErrorMessage(retryError), {
            cause: retryError,
          });
        }
      } else if (url && isHostAccessDenied(e)) {
        throw new UserFacingError(
          "Apogee needs permission to read this site. Click Summarize again and choose Allow when the browser asks.",
          { cause: e },
        );
      } else {
        throw new UserFacingError(injectionErrorMessage(e), { cause: e });
      }
    }
  }

  const pageData = await chrome.tabs.sendMessage(tabId, {
    action: "extract-page-content",
  });
  if (pageData?.error) throw new Error(pageData.error);
  return pageData || null;
}

// Chrome extension messaging has an internal size ceiling. Base64 costs 1.33× and the chunked String.fromCharCode loop holds a second full copy, so we cap the raw PDF size well below the point where sendMessage would silently fail.
export async function extractPdfContent(tab) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (maxSize) => {
      const res = await fetch(window.location.href);
      if (!res.ok) throw new Error(`Failed to download PDF: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > maxSize) {
        throw new Error(
          `PDF_TOO_LARGE: This PDF is ${Math.round(bytes.length / 1024 / 1024)} MB, ` +
            `which exceeds the ${Math.round(maxSize / 1024 / 1024)} MB limit ` +
            `for in-extension processing.`,
        );
      }
      let base64 = "";
      // Encode slice-by-slice (#267): a single binary string for the whole
      // file would sit next to the bytes and the base64 output (~3x the PDF
      // in memory). The slice size stays a multiple of 3 so each slice maps
      // to whole base64 quanta and boundary bytes are never corrupted.
      const CHUNK = 0x9000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, i + CHUNK);
        let binary = "";
        const STEP = 0x8000;
        for (let j = 0; j < slice.length; j += STEP) {
          binary += String.fromCharCode.apply(
            null,
            slice.subarray(j, j + STEP),
          );
        }
        base64 += btoa(binary);
      }
      return base64;
    },
    args: [MAX_UPLOAD_FILE_BYTES],
  });
  const pdfBase64 = results?.[0]?.result;
  if (!pdfBase64) throw new UserFacingError("Could not download PDF.");

  const response = await chrome.runtime.sendMessage({
    target: "service-worker",
    action: "extract-pdf",
    payload: { pdfBase64 },
  });
  if (response?.error) throw new Error(response.error);
  return response?.text || "";
}
