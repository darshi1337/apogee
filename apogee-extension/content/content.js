// Dispatches to the appropriate extractor based on the current site.

function extractPageContent() {
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
    const data = extractYoutube();
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
