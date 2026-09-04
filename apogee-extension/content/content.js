async function extractPageContent() {
  const url = window.location.href.toLowerCase();
  const host = window.location.hostname.toLowerCase();

  const isHost = (domain) => host === domain || host.endsWith(`.${domain}`);

  if (url.endsWith(".pdf") || document.contentType === "application/pdf") {
    return {
      title: document.title,
      url: window.location.href,
      content: null,
      isPdf: true,
    };
  }

  if (isHost("youtube.com")) {
    const data = await extractYoutube();
    return { ...data, isPdf: false };
  }

  if (isHost("bilibili.com")) {
    const data = await extractBilibili();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("mail.google.com")) {
    const data = extractGmail();
    return { ...data, isPdf: false };
  }

  if (isHost("news.ycombinator.com")) {
    const data = extractHackerNews();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("reddit.com")) {
    const data = await extractReddit();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("lobste.rs")) {
    const data = extractLobsters();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("github.com")) {
    const data = await extractGitHub();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("gitlab.com")) {
    const data = await extractGitLab();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("wikipedia.org")) {
    const data = extractWikipedia();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("arxiv.org")) {
    const data = extractArxiv();
    if (data) return { ...data, isPdf: false };
  }

  const stackOverflowData = extractStackOverflow();
  if (stackOverflowData) return { ...stackOverflowData, isPdf: false };

  const mastodonData = extractMastodon();
  if (mastodonData) return { ...mastodonData, isPdf: false };

  const lemmyData = extractLemmy();
  if (lemmyData) return { ...lemmyData, isPdf: false };

  const discourseData = extractDiscourse();
  if (discourseData) return { ...discourseData, isPdf: false };

  const blueskyData = await extractBluesky();
  if (blueskyData) return { ...blueskyData, isPdf: false };

  const data = extractGeneric();
  return { ...data, isPdf: false };
}

if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id && sender.id !== chrome.runtime.id) return;
    if (message && message.action === "extract-page-content") {
      extractPageContent()
        .then((data) => sendResponse(data))
        .catch((err) => sendResponse({ error: err?.message || String(err) }));
      return true;
    }
  });
}
