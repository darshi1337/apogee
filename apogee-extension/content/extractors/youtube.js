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

function getPlayerResponse() {
  const currentVideoId = new URLSearchParams(location.search).get("v");
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
      const parsed = JSON.parse(json);
      if (
        currentVideoId &&
        parsed?.videoDetails?.videoId &&
        parsed.videoDetails.videoId !== currentVideoId
      ) {
        continue;
      }
      return parsed;
    } catch {}
  }
  return null;
}

function decodeHtmlEntities(text) {
  // Decode the XML/HTML entities YouTube captions use without parsing HTML:
  // assigning to innerHTML here would sink transcript text into an HTML
  // parser (harmless on a detached textarea, but the same pattern elsewhere
  // is a real XSS sink), so decode the known entities by replacement.
  return String(text ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return _;
      }
    })
    .replace(/&amp;/g, "&");
}

function isAllowedCaptionUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const allowedSuffixes = [".youtube.com", ".googlevideo.com"];
  return (
    host === "youtube.com" ||
    allowedSuffixes.some((suffix) => host.endsWith(suffix))
  );
}

function captionUrlWithFormat(baseUrl, fmt) {
  try {
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("fmt", fmt);
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchTranscript(playerResponse) {
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) return [];

  const preferredLang = (navigator.language || "en").split("-")[0];
  const track =
    tracks.find((t) => t.languageCode === preferredLang && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === preferredLang) ||
    tracks.find((t) => t.kind !== "asr") ||
    tracks[0];

  if (!track.baseUrl) return [];

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
    } catch {}
  }

  return [];
}

function inAnyRange(t, ranges) {
  return ranges.some(([start, end]) => t >= start && t <= end);
}

function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const TIMESTAMP_MARKER_INTERVAL_SECONDS = 20;

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

const SPONSOR_WINDOW_LEAD = 3;
const SPONSOR_WINDOW_LEN = 45;

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
      ranges = [];
    }
  }

  const kept = ranges.length
    ? segments.filter((seg) => !inAnyRange(seg.start, ranges))
    : heuristicStripSponsors(segments);

  let lastMarked = -Infinity;
  const parts = [];
  for (const seg of kept) {
    if (seg.start - lastMarked >= TIMESTAMP_MARKER_INTERVAL_SECONDS) {
      parts.push(`[${formatTimestamp(seg.start)}]`);
      lastMarked = seg.start;
    }
    parts.push(seg.text);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

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
    /\btry (it|out|now)\b.*\b(free|at)\b/i,
    /\bfor free at\b/i,
    /\bget your (first|free)\b/i,
    /\bsign up\b/i,
    /\bavailable in (multiple|other|several|\w+ languages?|spanish|french|german|portuguese|italian|hindi|arabic|japanese|korean|russian|chinese)\b/i,
    /\blinks? (below|in the description)\b/i,
    /^(chapters?|timestamps?|links?|social(s)?)\s*:?\s*$/i,
  ];

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

const CHAPTER_LINE =
  /^\s*(?:[-•*]\s*)?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b[\s\-–—:.)]*(.+?)\s*$/;

function parseDescriptionChapters(description, durationSeconds) {
  if (!description) return [];

  const byStart = new Map();
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(CHAPTER_LINE);
    if (!m) continue;
    const [, h, mm, ss, titleRaw] = m;
    const start = (h ? Number(h) * 3600 : 0) + Number(mm) * 60 + Number(ss);
    const title = titleRaw.trim().replace(/\s+/g, " ");
    if (!title || title.length > 100) continue;
    if (!byStart.has(start)) byStart.set(start, title);
  }

  let chapters = [...byStart.entries()]
    .map(([start, title]) => ({ start, title }))
    .sort((a, b) => a.start - b.start);

  if (durationSeconds) {
    chapters = chapters.filter((c) => c.start <= durationSeconds);
  }

  if (chapters.length < 3 || chapters[0].start !== 0) return [];
  return chapters;
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

  const description =
    videoDetails?.shortDescription ||
    document.querySelector("#description-inline-expander")?.innerText ||
    document.querySelector("#description ytd-text-inline-expander")
      ?.innerText ||
    "";

  const durationSeconds = videoDetails?.lengthSeconds
    ? Number(videoDetails.lengthSeconds)
    : 0;
  const duration = durationSeconds
    ? `${Math.round(durationSeconds / 60)} min`
    : "";

  const commentEls = Array.from(
    document.querySelectorAll("#content-text.ytd-comment-renderer"),
  ).filter(
    (el) => el && (typeof el.isConnected === "undefined" || el.isConnected),
  );
  const comments = commentEls
    .slice(0, 25)
    .map((el) => (el?.innerText || el?.textContent || "").trim())
    .filter(Boolean);

  const infoEl = document.querySelector("#info-strings");
  const info = infoEl
    ? (infoEl.innerText || infoEl.textContent || "").trim()
    : "";

  const videoId =
    videoDetails?.videoId ||
    new URLSearchParams(location.search).get("v") ||
    "";
  const transcriptSegments = await fetchTranscript(playerResponse);
  const transcript = await buildCleanTranscript(transcriptSegments, videoId);

  let cleanedDescription = cleanDescription(description);
  if (transcript && cleanedDescription.length > 500) {
    cleanedDescription = `${cleanedDescription.slice(0, 500).trim()}…`;
  }

  const lastAvailableSeconds = transcriptSegments.length
    ? transcriptSegments[transcriptSegments.length - 1].start
    : 0;

  let content = `Video Title:\n${title}\n`;
  if (channel) content += `\nChannel: ${channel}\n`;
  if (duration) content += `\nDuration: ${duration}\n`;
  if (info) content += `\n${info}\n`;
  if (cleanedDescription) content += `\nDescription:\n${cleanedDescription}\n`;
  const chapters = transcript
    ? parseDescriptionChapters(description, durationSeconds)
    : [];
  if (chapters.length) {
    content += `\nChapters:\n${chapters
      .map((c) => `- [${formatTimestamp(c.start)}] ${c.title}`)
      .join("\n")}\n`;
  }
  content += transcript
    ? `\nLast transcript timestamp: ${formatTimestamp(lastAvailableSeconds)} (${Math.floor(lastAvailableSeconds)}s)\n\nTranscript:\n${transcript}\n`
    : "\n(No transcript/captions available for this video.)\n";
  if (comments.length > 0) {
    content += `\nTop Comments:\n${comments.map((c) => `- ${c}`).join("\n")}\n`;
  }

  return {
    type: "youtube",
    title,
    url: location.href,
    content,
    durationSeconds,
  };
}
