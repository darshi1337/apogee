function extractYoutube() {
  const title =
    document.querySelector("h1.ytd-watch-metadata")?.innerText ||
    document.title;

  const channel =
    document.querySelector("#channel-name a")?.innerText ||
    document.querySelector("ytd-channel-name a")?.innerText ||
    "";

  const description =
    document.querySelector("#description-inline-expander")?.innerText ||
    document.querySelector("#description ytd-text-inline-expander")
      ?.innerText ||
    "";

  // Grab visible comments if available
  const commentEls = document.querySelectorAll(
    "#content-text.ytd-comment-renderer",
  );
  const comments = Array.from(commentEls)
    .slice(0, 15)
    .map((el) => el.innerText.trim())
    .filter(Boolean);

  // Grab video metadata (views, date)
  const infoEl = document.querySelector("#info-strings");
  const info = infoEl ? infoEl.innerText.trim() : "";

  let content = `Video Title:\n${title}\n`;
  if (channel) content += `\nChannel: ${channel}\n`;
  if (info) content += `\n${info}\n`;
  content += `\nDescription:\n${description}\n`;
  if (comments.length > 0) {
    content += `\nTop Comments:\n${comments.map((c) => `- ${c}`).join("\n")}\n`;
  }

  return {
    type: "youtube",
    title,
    url: location.href,
    content,
  };
}
