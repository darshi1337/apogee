// Dispatches to the appropriate extractor based on the current site.
// Async because extractYoutube() fetches the transcript; chrome.scripting.
// executeScript awaits a returned promise from the injected function, so
// callers (popup.js) don't need to change how they invoke this.
async function extractPageContent() {
  const url = window.location.href.toLowerCase();
  const host = window.location.hostname.toLowerCase();

  // Exact-host / suffix match rather than substring: `includes("youtube.com")`
  // would also match a look-alike page like "youtube.com.attacker.com" and
  // run the site-specific extractor (which fetches page-supplied URLs) there.
  const isHost = (domain) => host === domain || host.endsWith(`.${domain}`);

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
  if (isHost("youtube.com")) {
    const data = await extractYoutube();
    return { ...data, isPdf: false };
  }

  // Gmail
  if (isHost("mail.google.com")) {
    const data = extractGmail();
    return { ...data, isPdf: false };
  }

  // Default: Readability-based generic extractor
  const data = extractGeneric();
  return { ...data, isPdf: false };
}

window.extractPageContent = extractPageContent;
