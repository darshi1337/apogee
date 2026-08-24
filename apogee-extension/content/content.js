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

  if (isHost("wikipedia.org")) {
    const data = extractWikipedia();
    if (data) return { ...data, isPdf: false };
  }

  if (isHost("arxiv.org")) {
    const data = extractArxiv();
    if (data) return { ...data, isPdf: false };
  }

  const data = extractGeneric();
  return { ...data, isPdf: false };
}

window.extractPageContent = extractPageContent;

true;
