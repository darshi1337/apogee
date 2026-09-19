function getBiliInitialState() {
  const path = location.pathname.toLowerCase();
  const scripts = liveEls(document.querySelectorAll("script"));
  for (const script of scripts) {
    const text = script?.textContent || "";
    if (!text || !text.includes("__INITIAL_STATE__")) continue;
    const assign = text.match(/window\.__INITIAL_STATE__\s*=\s*/);
    if (!assign) continue;
    const openIndex = text.indexOf("{", assign.index + assign[0].length);
    if (openIndex === -1) continue;
    const json = extractBalancedJsonText(text, openIndex);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json);
      const bvid = parsed?.bvid || parsed?.videoData?.bvid;
      const aid = parsed?.aid || parsed?.videoData?.aid;
      if (bvid && !path.includes(String(bvid).toLowerCase())) {
        if (!aid || !path.includes(String(aid).toLowerCase())) {
          continue;
        }
      }
      return parsed;
    } catch {}
  }
  return null;
}

const BILI_TIMESTAMP_MARKER_INTERVAL_SECONDS = 20;

function buildBiliTranscript(segments) {
  if (!segments.length) return "";
  return markTranscriptSegments(
    segments,
    formatVideoTimestamp,
    BILI_TIMESTAMP_MARKER_INTERVAL_SECONDS,
  );
}

function cleanBiliDescription(description) {
  if (!description) return "";
  const urlOnlyLine = /^\s*(https?:\/\/|www\.)\S+\s*$/i;
  return description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !urlOnlyLine.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchBiliSubtitles({ aid, bvid, cid }) {
  try {
    const resp = await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "bilibili-subtitles",
      payload: {
        aid,
        bvid,
        cid,
        preferredLang: navigator.language || "zh",
      },
    });
    return Array.isArray(resp?.segments) ? resp.segments : [];
  } catch {
    return [];
  }
}

async function extractBilibili() {
  const state = getBiliInitialState();
  const videoData = state?.videoData;
  if (!videoData || !videoData.title) return null;

  const title = videoData.title;
  const channel = videoData.owner?.name || "";
  const description = videoData.desc || videoData.dynamic || "";

  const pages = Array.isArray(videoData.pages) ? videoData.pages : [];
  const partParam = Number(new URLSearchParams(location.search).get("p")) || 1;
  const currentPage = pages[partParam - 1] || pages[0] || null;
  const cid = currentPage?.cid || videoData.cid || "";

  const durationSeconds = currentPage?.duration || videoData.duration || 0;
  const duration = durationSeconds
    ? `${Math.round(durationSeconds / 60)} min`
    : "";

  const aid = videoData.aid || state?.aid || "";
  const bvid = videoData.bvid || state?.bvid || "";

  const segments = cid ? await fetchBiliSubtitles({ aid, bvid, cid }) : [];
  const transcript = buildBiliTranscript(segments);
  const lastAvailableSeconds = segments.length
    ? segments[segments.length - 1].start
    : 0;

  const cleanedDescription = truncateVideoDescription(
    cleanBiliDescription(description),
    transcript,
  );

  let content = `Video Title:\n${title}\n`;
  if (channel) content += `\nUploader: ${channel}\n`;
  if (duration) content += `\nDuration: ${duration}\n`;
  if (cleanedDescription) content += `\nDescription:\n${cleanedDescription}\n`;
  content += transcript
    ? `\nLast transcript timestamp: ${formatVideoTimestamp(lastAvailableSeconds)} (${Math.floor(lastAvailableSeconds)}s)\n\nTranscript:\n${transcript}\n`
    : "\n(No subtitles/captions available for this video.)\n";

  return {
    type: "bilibili",
    title,
    url: location.href,
    content,
    durationSeconds,
  };
}
