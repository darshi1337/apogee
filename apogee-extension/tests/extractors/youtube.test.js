import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function createMockScriptHtml(ytPlayerResponse) {
  const jsonStr = JSON.stringify(ytPlayerResponse);
  return `<!doctype html>
<html>
  <head>
    <title>Test Video Title - YouTube</title>
  </head>
  <body>
    <h1 class="ytd-watch-metadata">Test Video Title</h1>
    <div id="channel-name"><a>Test Channel</a></div>
    <script>
      var ytInitialPlayerResponse = ${jsonStr};
    </script>
  </body>
</html>`;
}

test("isAllowedCaptionUrl allows valid youtube.com and googlevideo.com https URLs", () => {
  const { isAllowedCaptionUrl } = loadExtractors({
    files: [
      "extractors/thread.js",
      "extractors/video.js",
      "extractors/youtube.js",
    ],
    url: YOUTUBE_URL,
    html: "<!doctype html><html><body></body></html>",
  });

  assert.strictEqual(
    isAllowedCaptionUrl("https://youtube.com/api/timedtext?v=123"),
    true,
  );
  assert.strictEqual(
    isAllowedCaptionUrl("https://www.youtube.com/api/timedtext?v=123"),
    true,
  );
  assert.strictEqual(
    isAllowedCaptionUrl(
      "https://rr5---sn-o0e7ener.googlevideo.com/videoplayback?fmt=json3",
    ),
    true,
  );
  assert.strictEqual(
    isAllowedCaptionUrl("https://subdomain.googlevideo.com/api/timedtext"),
    true,
  );
});

test("isAllowedCaptionUrl refuses non-https and untrusted domain URLs", () => {
  const { isAllowedCaptionUrl } = loadExtractors({
    files: [
      "extractors/thread.js",
      "extractors/video.js",
      "extractors/youtube.js",
    ],
    url: YOUTUBE_URL,
    html: "<!doctype html><html><body></body></html>",
  });

  assert.strictEqual(
    isAllowedCaptionUrl("http://youtube.com/api/timedtext?v=123"),
    false,
    "http youtube",
  );
  assert.strictEqual(
    isAllowedCaptionUrl("http://www.googlevideo.com/api/timedtext"),
    false,
    "http googlevideo",
  );
  assert.strictEqual(
    isAllowedCaptionUrl("https://malicious-site.com/api/timedtext"),
    false,
    "malicious site",
  );
  assert.strictEqual(
    isAllowedCaptionUrl("https://notyoutube.com/api/timedtext"),
    false,
    "notyoutube",
  );
  assert.strictEqual(
    isAllowedCaptionUrl("https://youtube.com.attacker.com/api/timedtext"),
    false,
    "youtube attacker suffix",
  );
  assert.strictEqual(
    isAllowedCaptionUrl("https://googlevideo.com.attacker.com/api/timedtext"),
    false,
    "googlevideo attacker suffix",
  );
  assert.strictEqual(
    isAllowedCaptionUrl("ftp://youtube.com/api/timedtext"),
    false,
    "ftp protocol",
  );
});

test("fetchTranscript refuses caption track pointing at non-YouTube host", async () => {
  let fetchCalled = false;
  const fetchStub = async () => {
    fetchCalled = true;
    return {
      ok: true,
      text: async () =>
        '<transcript><text start="0">Hello world</text></transcript>',
    };
  };

  const playerResponse = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://evil-attacker.com/fake-caption",
            languageCode: "en",
          },
        ],
      },
    },
  };

  const { fetchTranscript } = loadExtractors({
    files: [
      "extractors/thread.js",
      "extractors/video.js",
      "extractors/youtube.js",
    ],
    url: YOUTUBE_URL,
    html: "<!doctype html><html><body></body></html>",
    fetch: fetchStub,
  });

  const segments = await fetchTranscript(playerResponse);

  assert.strictEqual(
    fetchCalled,
    false,
    "fetch should not have been called for untrusted caption URL",
  );
  assert.strictEqual(segments.length, 0);
});

test("fetchTranscript successfully fetches and parses XML transcript from allowed URL", async () => {
  const fetchedUrls = [];
  const fetchStub = async (url) => {
    fetchedUrls.push(url);
    return {
      ok: true,
      text: async () => `<transcript>
        <text start="0">Hello and welcome</text>
        <text start="5.5">To this tutorial</text>
      </transcript>`,
    };
  };

  const playerResponse = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://www.youtube.com/api/timedtext?v=123",
            languageCode: "en",
          },
        ],
      },
    },
  };

  const { fetchTranscript } = loadExtractors({
    files: [
      "extractors/thread.js",
      "extractors/video.js",
      "extractors/youtube.js",
    ],
    url: YOUTUBE_URL,
    html: "<!doctype html><html><body></body></html>",
    fetch: fetchStub,
  });

  const segments = await fetchTranscript(playerResponse);

  assert.strictEqual(fetchedUrls.length > 0, true);
  assert.ok(fetchedUrls[0].startsWith("https://www.youtube.com/api/timedtext"));
  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[0].text, "Hello and welcome");
  assert.strictEqual(segments[1].text, "To this tutorial");
});

test("fetchTranscript successfully fetches and parses JSON transcript from allowed URL", async () => {
  const fetchStub = async () => {
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          events: [
            { tStartMs: 1000, segs: [{ utf8: "First " }, { utf8: "segment" }] },
            { tStartMs: 4000, segs: [{ utf8: "Second segment" }] },
          ],
        }),
    };
  };

  const playerResponse = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://rr1---sn-example.googlevideo.com/videoplayback",
            languageCode: "en",
          },
        ],
      },
    },
  };

  const { fetchTranscript } = loadExtractors({
    files: [
      "extractors/thread.js",
      "extractors/video.js",
      "extractors/youtube.js",
    ],
    url: YOUTUBE_URL,
    html: "<!doctype html><html><body></body></html>",
    fetch: fetchStub,
  });

  const segments = await fetchTranscript(playerResponse);

  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[0].text, "First segment");
  assert.strictEqual(segments[1].text, "Second segment");
});

test("extractYoutube full extraction flow with playerResponse script element", async () => {
  const fetchStub = async () => ({
    ok: true,
    text: async () => `<transcript>
      <text start="0">Welcome to the video.</text>
      <text start="25">This is the main content.</text>
    </transcript>`,
  });

  const chromeStub = {
    runtime: {
      sendMessage: async () => ({ segments: [] }),
    },
  };

  const ytPlayerResponse = {
    videoDetails: {
      title: "Extracted Video Title",
      author: "Awesome Creator",
      shortDescription:
        "Check out this cool video!\nHere is actual info.\nSubscribe for more!",
      lengthSeconds: "120",
      videoId: "dQw4w9WgXcQ",
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ",
            languageCode: "en",
          },
        ],
      },
    },
  };

  const html = createMockScriptHtml(ytPlayerResponse);

  const { extractYoutube } = loadExtractors({
    files: [
      "extractors/thread.js",
      "extractors/video.js",
      "extractors/youtube.js",
    ],
    url: YOUTUBE_URL,
    html,
    fetch: fetchStub,
    chrome: chromeStub,
  });

  const result = await extractYoutube();

  assert.strictEqual(result.type, "youtube");
  assert.strictEqual(result.title, "Extracted Video Title");
  assert.strictEqual(result.durationSeconds, 120);
  assert.match(result.content, /Video Title:\nExtracted Video Title/);
  assert.match(result.content, /Channel: Awesome Creator/);
  assert.match(result.content, /Duration: 2 min/);
  assert.match(result.content, /Description:\nHere is actual info\./);
  assert.match(result.content, /\[0:00\] Welcome to the video\./);
  assert.match(result.content, /\[0:25\] This is the main content\./);
});
