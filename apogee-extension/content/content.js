async function extractPageContent() {
  const url = window.location.href.toLowerCase();
  const host = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  const isHost = (domain) => host === domain || host.endsWith(`.${domain}`);

  const tryExtractor = async (extractor) => {
    try {
      return await extractor();
    } catch {
      return null;
    }
  };

  if (
    pathname.endsWith(".pdf") ||
    document.contentType === "application/pdf"
  ) {
    return {
      title: document.title,
      url: window.location.href,
      content: null,
      isPdf: true,
    };
  }

  if (isHost("youtube.com") || isHost("youtu.be")) {
    const data = await tryExtractor(extractYoutube);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("bilibili.com")) {
    const data = await tryExtractor(extractBilibili);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("mail.google.com")) {
    const data = await tryExtractor(extractGmail);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("news.ycombinator.com")) {
    const data = await tryExtractor(extractHackerNews);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("reddit.com")) {
    const data = await tryExtractor(extractReddit);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("lobste.rs")) {
    const data = await tryExtractor(extractLobsters);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("github.com")) {
    const data = await tryExtractor(extractGitHub);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("gitlab.com")) {
    const data = await tryExtractor(extractGitLab);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("wikipedia.org")) {
    const data = await tryExtractor(extractWikipedia);
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("arxiv.org")) {
    const data = await tryExtractor(extractArxiv);
    if (data) return { ...data, isPdf: false };
  }

  const stackOverflowData = await tryExtractor(extractStackOverflow);
  if (stackOverflowData) {
    return { ...stackOverflowData, isPdf: false };
  }

  const mastodonData = await tryExtractor(extractMastodon);
  if (mastodonData) {
    return { ...mastodonData, isPdf: false };
  }

  const lemmyData = await tryExtractor(extractLemmy);
  if (lemmyData) {
    return { ...lemmyData, isPdf: false };
  }

  const discourseData = await tryExtractor(extractDiscourse);
  if (discourseData) {
    return { ...discourseData, isPdf: false };
  }

  const devtoData = await tryExtractor(extractDevto);
  if (devtoData) {
    return { ...devtoData, isPdf: false };
  }

  const blueskyData = await tryExtractor(extractBluesky);
  if (blueskyData) {
    return { ...blueskyData, isPdf: false };
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
