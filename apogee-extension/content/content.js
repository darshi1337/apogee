async function extractPageContent() {
  const host = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  const isHost = (domain) => host === domain || host.endsWith(`.${domain}`);

  const tryExtractor = async (extractor) => {
    try {
      return await extractor();
    } catch (error) {
      console.warn(
        "Apogee extractor failed, falling back:",
        extractor?.name,
        error,
      );
      return null;
    }
  };

  if (pathname.endsWith(".pdf") || document.contentType === "application/pdf") {
    return {
      title: document.title,
      url: window.location.href,
      content: null,
      isPdf: true,
    };
  }

  // Host-gated extractors, tried in order. A null return falls through
  // to the next entry instead of aborting dispatch.
  const hostedExtractors = [
    [["youtube.com", "youtu.be"], extractYoutube],
    [["bilibili.com"], extractBilibili],
    [["mail.google.com"], extractGmail],
    [["news.ycombinator.com"], extractHackerNews],
    [["reddit.com"], extractReddit],
    [["lobste.rs"], extractLobsters],
    [["github.com"], extractGitHub],
    [["gitlab.com"], extractGitLab],
    [["wikipedia.org"], extractWikipedia],
    [["arxiv.org"], extractArxiv],
  ];

  for (const [domains, extractor] of hostedExtractors) {
    if (domains.some(isHost)) {
      const data = await tryExtractor(extractor);
      if (data) return { ...data, isPdf: false };
    }
  }

  // Probing extractors detect their pages by content, not by host.
  const probingExtractors = [
    extractStackOverflow,
    extractMastodon,
    extractLemmy,
    extractDiscourse,
    extractDevto,
    extractBluesky,
  ];

  for (const extractor of probingExtractors) {
    const data = await tryExtractor(extractor);
    if (data) return { ...data, isPdf: false };
  }

  const data = extractGeneric();
  return { ...data, isPdf: false };
}

if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return;
    // Extraction requests come from the extension page via tabs.sendMessage
    // (no sender tab); tab-hosted contexts must not pull page text this way.
    if (sender.tab) return;
    if (message && message.action === "extract-page-content") {
      extractPageContent()
        .then((data) => sendResponse(data))
        .catch((err) => sendResponse({ error: err?.message || String(err) }));
      return true;
    }
  });
}
