// Returns the `{...}` substring starting at openIndex, brace-matched while
// respecting string literals/escapes. A `/\{.*?\}/` regex can't do this, it
// stops at the first `}` inside the nested object.
function extractBalancedObject(text, openIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return null;
}

// Pulls the inline `ytInitialPlayerResponse = {...}` blob YouTube embeds in
// a <script> tag on page load. Content scripts run in an isolated JS world,
// so the page's own `window.ytInitialPlayerResponse` global isn't reachable
// directly, but the raw script text is, since the DOM is shared.
function getPlayerResponse() {
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    if (!text || !text.includes("ytInitialPlayerResponse")) continue;
    const assign = text.match(/ytInitialPlayerResponse\s*=\s*/);
    if (!assign) continue;
    const openIndex = text.indexOf("{", assign.index + assign[0].length);
    if (openIndex === -1) continue;
    const json = extractBalancedObject(text, openIndex);
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
      // Malformed/unexpected script content, keep looking.
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

// Caption tracks are served from youtube.com / *.youtube.com and
// *.googlevideo.com. Accept only those hosts (over https) via exact suffix
// matching, not a substring test, which "youtube.com.attacker.com" passes.
function isAllowedCaptionUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  // Caption tracks are only ever served from these two, a broader
  // "*.google.com" suffix would also accept e.g. an authenticated
  // mail.google.com URL smuggled in through a crafted ytInitialPlayerResponse.
  const allowedSuffixes = [".youtube.com", ".googlevideo.com"];
  return (
    host === "youtube.com" ||
    allowedSuffixes.some((suffix) => host.endsWith(suffix))
  );
}

// Builds a caption URL for a format, replacing any existing `fmt` param.
function captionUrlWithFormat(baseUrl, fmt) {
  try {
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("fmt", fmt);
    return url.toString();
  } catch {
    return null;
  }
}

// Returns timed transcript segments (`[{ start, text }]`), or `[]` if the
// video has no usable captions.
async function fetchTranscript(playerResponse) {
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) return [];

  // Prefer a human-written track in the viewer's language, then any
  // human-written track, then fall back to auto-generated (kind "asr").
  const preferredLang = (navigator.language || "en").split("-")[0];
  const track =
    tracks.find((t) => t.languageCode === preferredLang && t.kind !== "asr") ||
    tracks.find((t) => t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === preferredLang) ||
    tracks[0];

  if (!track.baseUrl) return [];

  // The timedtext endpoint increasingly returns an empty 200 body for some
  // formats when fetched outside the player, so probe json3 then legacy XML.
  for (const fmt of ["json3", "srv3", ""]) {
    const target = fmt
      ? captionUrlWithFormat(track.baseUrl, fmt)
      : track.baseUrl;
    if (!target || !isAllowedCaptionUrl(target)) continue;
    try {
      const res = await fetch(target);
      if (!res.ok) continue;
      const raw = await res.text();
      if (!raw.trim()) continue;
      const segments = parseTranscript(raw);
      if (segments.length) return segments;
    } catch {
      // Try the next format.
    }
  }

  return [];
}

// True when timestamp `t` (seconds) falls inside any `[start, end]` range.
function inAnyRange(t, ranges) {
  return ranges.some(([start, end]) => t >= start && t <= end);
}

// High-precision sponsor-read openers, used only as a fallback when a video
// has no SponsorBlock data. Kept deliberately narrow so we don't cut
// substantive content; each match drops a ~45s window (a typical read length)
// starting slightly before the trigger.
const SPONSOR_TRIGGERS = [
  /sponsored by/i,
  /this (?:video|episode) is (?:sponsored|brought to you)/i,
  /today'?s sponsor/i,
  /thanks? to .{0,40}? for sponsoring/i,
  /\buse (?:the )?(?:promo |discount )?code\b/i,
  /\bpromo code\b/i,
  /link in the (?:description|bio)/i,
  /use my link/i,
  /\bhead (?:over )?to \S{0,30}?\.com\b/i,
];

const SPONSOR_WINDOW_LEAD = 3; // seconds trimmed before a trigger
const SPONSOR_WINDOW_LEN = 45; // seconds dropped from a trigger onward

// Local, network-free fallback: drop segments within a window of any segment
// whose text matches a sponsor-read opener.
function heuristicStripSponsors(segments) {
  const windows = [];
  for (const seg of segments) {
    if (SPONSOR_TRIGGERS.some((re) => re.test(seg.text))) {
      windows.push([
        seg.start - SPONSOR_WINDOW_LEAD,
        seg.start + SPONSOR_WINDOW_LEN,
      ]);
    }
  }
  if (!windows.length) return segments;
  return segments.filter((seg) => !inAnyRange(seg.start, windows));
}

// Removes sponsor / self-promo / subscribe-plug segments from the timed
// transcript before it ever reaches the summarizer (far more reliable than
// asking a small model to "ignore sponsors"). Prefers SponsorBlock's
// crowdsourced timestamps, fetched via the service worker, which sends only a
// privacy-preserving 4-char hash prefix of the video id; when a video has no
// SponsorBlock data, falls back to the local phrase heuristic. Returns a plain
// transcript string.
async function buildCleanTranscript(segments, videoId) {
  if (!segments.length) return "";

  let ranges = [];
  if (videoId) {
    try {
      const resp = await chrome.runtime.sendMessage({
        target: "service-worker",
        action: "sponsorblock-segments",
        payload: { videoId },
      });
      ranges = Array.isArray(resp?.segments) ? resp.segments : [];
    } catch {
      // Service worker unreachable / context invalidated, fall back below.
      ranges = [];
    }
  }

  const kept = ranges.length
    ? segments.filter((seg) => !inAnyRange(seg.start, ranges))
    : heuristicStripSponsors(segments);

  return kept
    .map((seg) => seg.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// Handles both caption formats: `json3` (an `events[].segs[].utf8` structure)
// and the legacy XML (`<text>` nodes). Detects which by sniffing the payload.
// Returns timed segments (`[{ start, text }]`, start in seconds) rather than a
// flat string, so sponsor time-ranges from SponsorBlock can later be mapped
// onto the transcript to drop the sponsored parts.
function parseTranscript(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return (data.events || [])
        .map((e) => ({
          start: (e.tStartMs ?? 0) / 1000,
          text: (e.segs || [])
            .map((s) => s.utf8 || "")
            .join("")
            .replace(/\s+/g, " ")
            .trim(),
        }))
        .filter((seg) => seg.text);
    } catch {
      return [];
    }
  }
  const doc = new DOMParser().parseFromString(raw, "text/xml");
  return Array.from(doc.getElementsByTagName("text"))
    .map((node) => ({
      start: parseFloat(node.getAttribute("start") || "0") || 0,
      text: decodeHtmlEntities(node.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((seg) => seg.text);
}

// Strips marketing boilerplate (sponsor reads, CTAs, social/affiliate links,
// chapter dumps, hashtags) from a description so it doesn't leak into
// summaries, most damaging on videos with no transcript.
function cleanDescription(description) {
  if (!description) return "";

  const promoPatterns = [
    /\bsubscribe\b/i,
    /\bfollow (me|us|along)\b/i,
    /\blike,? (and|&) subscribe\b/i,
    /\bhit the bell\b/i,
    /\bturn on notifications\b/i,
    /\bcheck out\b/i,
    /\bsponsor(ed|ship)?\b/i,
    /\bpromo ?code\b/i,
    /\buse code\b/i,
    /\bdiscount\b/i,
    /\baffiliate\b/i,
    /\bmerch\b/i,
    /\bpatreon\b/i,
    /\bko-?fi\b/i,
    /\bjoin (this|our|my) (channel|membership|discord)\b/i,
    /\b(instagram|twitter|tiktok|facebook|discord|threads)\b/i,
    /\bfollow us on\b/i,
    // The trailing "|" here used to leave the "it/out/now" group able to
    // match on nothing, so "try" appearing anywhere on a line combined with
    // any later occurrence of the extremely common word "at" matched almost
    // every line in a typical description. Requiring one of the three
    // alternatives keeps this targeted at actual "try it/out/now ... free"
    // pitches.
    /\btry (it|out|now)\b.*\b(free|at)\b/i,
    /\bfor free at\b/i,
    /\bget your (first|free)\b/i,
    /\bsign up\b/i,
    /\bavailable in (multiple|other|several|\w+ languages?|spanish|french|german|portuguese|italian|hindi|arabic|japanese|korean|russian|chinese)\b/i,
    /\blinks? (below|in the description)\b/i,
    /^(chapters?|timestamps?|links?|social(s)?)\s*:?\s*$/i,
  ];

  // A dedicated, anchored check for hashtag-dump lines ("#AI #ML #Tech"),
  // rather than folding `#\w+` into promoPatterns above, that unanchored
  // form matched (and dropped) any line merely *containing* one hashtag
  // anywhere, including a substantive sentence that happens to mention one
  // mid-paragraph (e.g. "Check out my post about #AI in healthcare").
  const hashtagOnlyLine = /^(#\w+[\s,]*)+$/;

  const timestampLine = /^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\b/;
  const urlOnlyLine = /^\s*(https?:\/\/|www\.)\S+\s*$/i;

  const kept = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (timestampLine.test(line)) return false;
      if (urlOnlyLine.test(line)) return false;
      if (hashtagOnlyLine.test(line)) return false;
      if (promoPatterns.some((re) => re.test(line))) return false;
      return true;
    });

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const videoId =
    videoDetails?.videoId ||
    new URLSearchParams(location.search).get("v") ||
    "";
  const transcriptSegments = await fetchTranscript(playerResponse);
  const transcript = await buildCleanTranscript(transcriptSegments, videoId);

  // With a transcript the description is just context, so cap it short.
  let cleanedDescription = cleanDescription(description);
  if (transcript && cleanedDescription.length > 500) {
    cleanedDescription = `${cleanedDescription.slice(0, 500).trim()}…`;
  }

  let content = `Video Title:\n${title}\n`;
  if (channel) content += `\nChannel: ${channel}\n`;
  if (duration) content += `\nDuration: ${duration}\n`;
  if (info) content += `\n${info}\n`;
  if (cleanedDescription) content += `\nDescription:\n${cleanedDescription}\n`;
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
