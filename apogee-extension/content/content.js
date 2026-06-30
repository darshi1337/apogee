// Dispatches to the appropriate extractor based on the current site.
// Extractors (generic.js, youtube.js) are loaded first via manifest.json.

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
    console.log("Apogee: using YouTube extractor");
    const data = extractYoutube();
    return { ...data, isPdf: false };
  }

  // Default: Readability-based generic extractor
  console.log("Apogee: using generic extractor");
  const data = extractGeneric();
  return { ...data, isPdf: false };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    sendResponse(extractPageContent());
  }
});
