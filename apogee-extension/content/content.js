// Dispatches to the appropriate extractor based on the current site.
// Async because extractYoutube() fetches the transcript; chrome.scripting.
// executeScript awaits a returned promise from the injected function, so
// callers (popup.js) don't need to change how they invoke this.
async function extractPageContent() {
  const url = window.location.href.toLowerCase();
  const host = window.location.hostname;

  // PDF detection
  if (url.endsWith(".pdf") || document.contentType === "application/pdf") {
    return {
      title: document.title,
      url: window.location.href,
      content: null,
      isPdf: true,
    };
  }

  // YouTube
  if (host.includes("youtube.com")) {
    const data = await extractYoutube();
    return { ...data, isPdf: false };
  }

  // Gmail
  if (host.includes("mail.google.com")) {
    const data = extractGmail();
    return { ...data, isPdf: false };
  }

  // Default: Readability-based generic extractor
  const data = extractGeneric();
  return { ...data, isPdf: false };
}

window.extractPageContent = extractPageContent;
