// Pulls the inline `ytInitialPlayerResponse = {...}` blob YouTube embeds in
// a <script> tag on page load. Content scripts run in an isolated JS world,
// so the page's own `window.ytInitialPlayerResponse` global isn't reachable
// directly — but the raw script text is, since the DOM is shared.
function getPlayerResponse() {
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    if (!text || !text.includes("ytInitialPlayerResponse")) continue;
    const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;/s);
    if (!match) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      // Malformed/unexpected script content — keep looking.
    }
  }
  return null;
}

// Caption text comes back XML-entity-encoded (&amp;, &#39;, ...). A
// detached <textarea> decodes entities without ever interpreting markup
// (textarea content is parsed as rawtext, not HTML), so this is safe even
// though the source is untrusted page content.
function decodeHtmlEntities(text) {
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

async function fetchTranscript(playerResponse) {
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) return "";

  // Prefer a human-written track in the viewer's language, then any
  // human-written track, then fall back to auto-generated (kind "asr").
  const preferredLang = (navigator.language || "en").split("-")[0];
  const track =
    tracks.find((t) => t.languageCode === preferredLang && t.kind !== "asr") ||
    tracks.find((t) => t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === preferredLang) ||
    tracks[0];

  try {
    const res = await fetch(track.baseUrl);
    if (!res.ok) return "";
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const lines = Array.from(doc.getElementsByTagName("text"))
      .map((node) =>
        decodeHtmlEntities(node.textContent || "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    return lines.join(" ");
  } catch {
    return "";
  }
}

async function extractYoutube() {
  const playerResponse = getPlayerResponse();
  const videoDetails = playerResponse?.videoDetails;

  const title =
    videoDetails?.title ||
    document.querySelector("h1.ytd-watch-metadata")?.innerText ||
    document.title;

  const channel =
    videoDetails?.author ||
    document.querySelector("#channel-name a")?.innerText ||
    document.querySelector("ytd-channel-name a")?.innerText ||
    "";

  // videoDetails.shortDescription is the full description text; the DOM
  // version is clipped behind a "...more" toggle unless the viewer expands it.
  const description =
    videoDetails?.shortDescription ||
    document.querySelector("#description-inline-expander")?.innerText ||
    document.querySelector("#description ytd-text-inline-expander")
      ?.innerText ||
    "";

  const duration = videoDetails?.lengthSeconds
    ? `${Math.round(Number(videoDetails.lengthSeconds) / 60)} min`
    : "";

  // Grab visible comments if available (YouTube lazy-loads these on scroll,
  // so this only sees whatever has already rendered).
  const commentEls = document.querySelectorAll(
    "#content-text.ytd-comment-renderer",
  );
  const comments = Array.from(commentEls)
    .slice(0, 25)
    .map((el) => el.innerText.trim())
    .filter(Boolean);

  // Grab video metadata (views, date)
  const infoEl = document.querySelector("#info-strings");
  const info = infoEl ? infoEl.innerText.trim() : "";

  const transcript = await fetchTranscript(playerResponse);

  let content = `Video Title:\n${title}\n`;
  if (channel) content += `\nChannel: ${channel}\n`;
  if (duration) content += `\nDuration: ${duration}\n`;
  if (info) content += `\n${info}\n`;
  if (description) content += `\nDescription:\n${description}\n`;
  content += transcript
    ? `\nTranscript:\n${transcript}\n`
    : "\n(No transcript/captions available for this video.)\n";
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
