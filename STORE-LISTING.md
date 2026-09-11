# Chrome Web Store listing

Version-controlled copy of the Apogee CWS submission fields. Update with each store submission. Version at last edit: 0.2.1.

Packaging: upload a ZIP of the Chromium build (`dist/chrome`), not a CRX. The store repacks and signs it. `npm run package` makes the release ZIP.

## Product details

- **Title:** Apogee

- **Summary:** AI browser assistant for articles, videos, emails and more. Runs in-browser via WebGPU and WebAssembly, or locally via Ollama and llama.cpp.

- **Category:** Productivity

- **Language:** English (United States)

- **Homepage URL:** https://darshi1337.github.io/apogee/

- **Support URL:** https://github.com/darshi1337/apogee/issues

- **Privacy policy URL:** https://github.com/darshi1337/apogee/blob/main/PRIVACY.md

- **Mature content:** No

### Description

Apogee is a private, in-browser AI assistant for articles, YouTube videos, PDFs, DOCX files, pasted text, emails, and more. It summarizes what you read or what you give it locally. It answers questions about that content, all on your own machine. No cloud, no API keys, no account, no telemetry. Your content never leaves your device.

WHY APOGEE

Most "AI summarizer" extensions send the page you read to company servers. Apogee does not. It runs compact language models straight inside your browser. It uses your GPU through WebGPU or your CPU through WebAssembly. The text you summarize stays local and drops after. There is no login and no leak.

The discontinued Orbit project from Mozilla inspired Apogee. It offered browser summarization but sent all through central cloud servers. Apogee fixes that by staying fully local-first. No server need means no data leaks and no subscription. Nothing shuts down or retires.

WHAT IT DOES

- Summarize any page: articles, blog posts, docs, long threads.

- Summarize local PDF and DOCX files, TXT, Markdown, JSON, or HTML files, or paste text from an offline app.

- Keep Apogee open in the Chrome side panel while reading, scrolling, or taking notes.

- Summarize YouTube and Bilibili videos from their transcript, with a "Key moments" timeline. Each link jumps the video to that moment.

- Ask questions about the page or given content. Apogee reads the whole source with on-device retrieval, not just the first few thousand chars. Answers can come from deep inside a long article, PDF, or transcript.

- Highlight-in-page finds summary passages in the original page. Click any bullet in a summary. Apogee scrolls to the passage and highlights it. Check any claim without re-reading all.

- Semantic summary search covers saved past summaries in real time. It uses on-device vector search across titles and summary bodies.

- Multiple summary formats exist: bullets, sentences, or paragraphs. Switch them right under the Summarize button.

- Custom instructions hold your standing guidance ("Explain like I'm five", "Focus on the technical details"). They apply to each summary and answer.

- Summaries come in your language. Pick one of 29 output languages (or keep the page own). The summarization model itself translates. Dedicated on-device translation models offer another option.

Fast ways to summarize without opening the popup:

- Right-click a page, then "Summarize this page".

- Use the keyboard shortcut (default Alt+Shift+U, changeable at chrome://extensions/shortcuts).

A system note tells you when the summary is ready.

TWO WAYS TO RUN IT

1. In-Browser AI (zero setup). Runs small, fast models fully in your browser. On first use it downloads the model weights (about 270 MB to 2.2 GB based on the model). It caches them locally. After that, all works offline. Defaults to WebGPU (WebLLM) on Chrome and Edge, with a WebAssembly (Transformers.js) option in Settings for machines without WebGPU.

2. Local Ollama (for power users). Prefer larger, stronger models? Point Apogee at your own local Ollama instance. It talks to it straight over 127.0.0.1. It needs no extra backend to install or run.

Any model you pulled shows up on its own. Still fully local. Nothing leaves your machine.

PRIVACY

- No cloud inference. Models run on your device.

- No API keys, no sign-in, no account.

- No analytics or tracking.

- Network access stays limited to these cases:

  - Model weight downloads from Hugging Face on first run. The dedicated translation engine uses a model from the same place, only if you opt in.

  - Your own local Ollama at 127.0.0.1.

  - For YouTube videos, Apogee fetches the caption track of the viewed video (youtube.com / googlevideo.com). It also calls the community SponsorBlock API to skip sponsor parts. Only a k-anonymity hash prefix goes out. Opt out under Settings, then Privacy for a fully local run with no lookup request at all.

  - For Bilibili videos, the subtitle endpoints of that site (api.bilibili.com, hdslb.com).

  - For Bluesky posts, the public AT Protocol thread endpoint (public.api.bsky.app).

  - For Reddit threads, the thread JSON of the viewed page (same-origin fetch, no extra host).

- Page content stays local. It never uploads.

REQUIREMENTS

- Chrome or Edge 116+ (or another Chromium browser based on Chromium 116+).

- A GPU with WebGPU support for the default In-Browser mode (most GPUs from the last several years).

- Without WebGPU, switch to the WebAssembly option in Settings or use Local Ollama.

- First run downloads model weights, so it needs internet once. After that it runs offline.

OPEN SOURCE

Apogee is free and open source (MIT licensed). Source, issues, and releases: https://github.com/darshi1337/apogee

## Single purpose description

Apogee summarizes the web page, video, or PDF the user currently views. It answers questions about that content. Both tasks use an AI model on the user own device. It runs in-browser through WebGPU or WebAssembly. It also runs through a local Ollama instance.

Each permission and feature serves this one purpose: on-device summarization and question-answering of the content the user actively looks at. Apogee sends no content to any remote server.

## Permission justifications

**activeTab** Apogee reads the content of the page the user actively views. It acts only when the user clearly starts it (toolbar click, right-click menu, or keyboard shortcut). It summarizes that page or answers questions about it. activeTab grants access to the current tab on user action. It avoids broad host permissions across all sites.

**scripting** On user action, Apogee injects a content script into the active tab. It pulls the readable text of the page (article body, YouTube transcript, or PDF text) to summarize. It scrolls to the source passage of a summary line and highlights it. It runs only on the tab the user started it on.

**storage** Stores the user local settings. They cover the picked AI provider and model, the summary format, and other prefs. They stay between sessions. This data stays on the device. It never leaves.

**offscreen** On Chromium, the extension service worker cannot reach WebGPU. Apogee uses an offscreen document to run the in-browser AI model outside any visible tab. It runs WebLLM on WebGPU, or Transformers.js on WebAssembly. Summarization runs in the background with no dedicated page.

**sidePanel** It keeps the current Apogee local summary and Ask interface open next to the page. It offers another choice besides the short-lived toolbar popup. It grants no access to page content or any network resource.

**unlimitedStorage** In-browser AI model weights are large (about 270 MB to 2.2 GB). Apogee caches them locally, so they download only once and then run fully offline.

unlimitedStorage stops the browser default storage quota from dropping these cached model files.

**alarms** It gives stable background timing under Manifest V3. The service worker ends when idle. Apogee schedules alarms to clean up finished summary streams. It closes the idle offscreen AI document after a timeout. Plain timers would not live through worker pauses.

**declarativeNetRequestWithHostAccess** Apogee strips the `Origin` header from requests to the user own Ollama server on `127.0.0.1`/`localhost`. Ollama accepts them without hand-set `OLLAMA_ORIGINS`. Where the browser supports session-scoped rules, the rule applies at runtime to requests from no tab. Those are the background fetches of the extension itself. No request on any website changes.

A bundled static rule scoped to those loopback hosts stays as a fallback. The rule changes nothing else. It blocks nothing else. It redirects nothing else.

**contextMenus** It adds a right-click "Summarize this page" menu item. Users start summarization straight without opening the popup.

**notifications** It shows a system note when a summary asked for with keyboard shortcut or context menu is ready. The popup often stays closed while the model generates.

**Host permission justification** (`http://127.0.0.1/*`, `http://localhost/*`) These loopback host permissions link Apogee to the user own local Ollama server. They serve users who opt into Local Ollama mode. Requests go straight to the model running on their own machine. Only loopback addresses on the user device take part.

**Host permission justification** (`*://*.bilibili.com/*`, `*://*.hdslb.com/*`, `*://*.youtube.com/*`, `*://*.googlevideo.com/*`, `*://*.bsky.app/*`, `https://sponsor.ajay.app/*`) The manifest states these site-specific cross-origin permissions as `optional_host_permissions` in `manifest.json`. When the user summarizes a Bilibili or YouTube video, Apogee checks granted permissions. It asks the user on demand before it fetches subtitles from the Bilibili API (`api.bilibili.com` / `hdslb.com`). It fetches the video caption track from YouTube endpoints through the page content script (`youtube.com` / `googlevideo.com`). It fetches SponsorBlock timestamps (`sponsor.ajay.app`, opt out under Settings, then Privacy to turn the lookup off fully).

When the user summarizes a Bluesky post, Apogee fetches the thread from the public AT Protocol endpoint. The address is `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread`. It carries only the public `at://` URI, with DOM fallback when offline. Standing host permissions cover loopback addresses only (`127.0.0.1`/`localhost`). Apogee reaches each other site on demand with `activeTab`.

## Remote code

**No, I am not using Remote code.**

Rationale: the WASM runtimes ship bundled in the package (Transformers.js WASM ships bundled. Apogee downloads WebLLM WASM kernels and SHA-256-checks them at build time and includes them in `dist/`. Nothing fetches them at runtime).

The only runtime downloads are model weight files from Hugging Face. They are data, not JS or Wasm. The Bluesky public thread API (`public.api.bsky.app`) returns JSON discussion data, not code. No `eval`, no outside `<script>` tags, no remotely-hosted modules.

## Data usage

Check no data-collection boxes. Google defines "collect" as moving data off the device. Apogee handles all page content locally and sends none of it. Reviewers at times expect the "Website content" box checked because the extension reads page content. Leaving it unchecked is honest for a local-only tool. The privacy policy explains why.

Certify all three disclosures (no selling/transfer, no unrelated use, no creditworthiness use). All true.

## Graphic assets checklist

- Store icon: 128x128 PNG

- Screenshots: at least 1, 1280x800 or 640x400, PNG without alpha or JPEG

- Small promo tile (optional): 440x280

- Marquee promo tile (optional): 1400x560

### The images

Each listing image lives committed in `.github/assets/`. Each store gets the same file reviewers see here. HTML and CSS built them in the design language of the marketing site (`docs/`).

Type uses Mozilla Headline and Mozilla Text. Purple is `#5855ff`. Grounds are `#f7f7f7` and `#161616`. Cards use lilac tints. Four vertical hairlines run through each image.

| File in `.github/assets/`        | Size      | Used for                     |
| -------------------------------- | --------- | ---------------------------- |
| `apogee-deck-1280x800-1..5.png`  | 1280x800  | Chrome Web Store screenshots |
| `apogee-deck-2400x1800-1..5.png` | 2400x1800 | Firefox Add-ons screenshots  |
| `apogee-promo-tile-440x280.png`  | 440x280   | Small promo tile             |
| `apogee-marquee-1400x560.png`    | 1400x560  | Marquee promo tile           |

### The five screenshots

Shown here at 1280x800, the size uploaded to the Chrome Web Store.

**1. Cover.** Headline, one-paragraph pitch, install CTA, and the popup in its default state.

![Cover slide](.github/assets/apogee-deck-1280x800-1.png)

**2. Why Apogee.** The common summarizer versus apogee, side by side, over the strip of supported sites.

![Why apogee slide](.github/assets/apogee-deck-1280x800-2.png)

**3. How it works.** WebGPU, WebAssembly, and Ollama. A crop of the real AI Provider settings. The four-step local pipeline.

![How it works slide](.github/assets/apogee-deck-1280x800-3.png)

**4. In the browser.** Three cropped screenshots as a numbered flow: start the summary, read it, then ask follow-up questions.

![In the browser slide](.github/assets/apogee-deck-1280x800-4.png)

**5. Get started.** Install CTA, the zero servers / 100% on device / MIT stats, and the outlined wordmark.

![Get started slide](.github/assets/apogee-deck-1280x800-5.png)

Slide 4 and the cover use crops of the popup captures in `.github/assets`. CSS crops from the 684px-wide originals with a `--y` offset in source pixels. Re-cropping takes a one-number edit instead of an image edit. Each crop fades out at the bottom in the panel own background color so a cut never lands mid-sentence.

### Promo tiles

Small tile, 440x280. Text stays light on purpose. Tiles often show small.

![Small promo tile](.github/assets/apogee-promo-tile-440x280.png)

Marquee, 1400x560. The wider canvas has room for the popup next to the pitch.

![Marquee promo tile](.github/assets/apogee-marquee-1400x560.png)

### Firefox Add-ons set

The same five slides at 2400x1800, carrying the Firefox CTA instead of the Chrome one. Uploaded to AMO, not to the Chrome Web Store.

![Cover slide, Firefox](.github/assets/apogee-deck-2400x1800-1.png)

![Why apogee slide, Firefox](.github/assets/apogee-deck-2400x1800-2.png)

![How it works slide, Firefox](.github/assets/apogee-deck-2400x1800-3.png)

![In the browser slide, Firefox](.github/assets/apogee-deck-2400x1800-4.png)

![Get started slide, Firefox](.github/assets/apogee-deck-2400x1800-5.png)

### Notes on the two sizes

One HTML file drives both aspect ratios: `1rem` ties to `vmin`. The type scale matches at 2400x1800 and 1280x800. Only the columns get wider. The 2400x1800 set comes from a 1200x900 capture with device scale 2 instead of native pixels. Text renders at 2x.

Each set carries only its own store install CTA, so the Chrome screenshots never advertise Firefox or the reverse.

Both tiles come from 2x captures, downsampled with Lanczos instead of 1:1 renders. The type reads cleanly at tile scale.
