# Apogee Privacy and Security Architecture

Privacy is the core promise of Apogee. The main guarantee is simple: your page content and the summaries or answers made from it never go to any cloud service or third party. Inference happens on your own device through WebGPU or WebAssembly, or on your own machine through local loopback to Ollama or llama.cpp (`http://127.0.0.1`). The details below state exactly which few network requests do happen and what is kept on disk.

## Where Inference Happens

- **In-Browser mode**: Tokenization and inference run fully on your local device, on the GPU through WebGPU (WebLLM, default on Chrome and Edge) or on the CPU through WebAssembly (Transformers.js, default on Firefox and an opt-in on Chrome and Edge). Your page content and summaries are never sent anywhere.
- **Local llama.cpp mode**: Page content travels only over local loopback (`http://127.0.0.1`) to your own `llama-server` process, never to the cloud, the same way Local Ollama mode works. Apogee refuses any host that is not `127.0.0.1` or `localhost`, so a remote server cannot be set even on purpose. If the server was started with `--api-key`, the key is stored with your other settings, sent only to that loopback address, and shown in diagnostics as `set` or `unset` instead of by value.
- **Local Ollama mode**: Page content travels only over local loopback (`http://127.0.0.1`) straight to your own Ollama instance HTTP API, never to the cloud. No middle backend sits in the path. The extension is the only client-side hop to Ollama.

## Outbound Network Connection Details

Apogee makes only a small set of outbound network requests:

- **Model Weight Downloads**: Model weights are downloaded once from Hugging Face in in-browser mode, or pulled by Ollama in local mode, then cached and reused offline. This sends no page content, only the model weight files themselves.
- **YouTube Transcripts**: On a YouTube page, the content-script extractor fetches that video caption track from YouTube endpoints (`youtube.com` or `googlevideo.com`), which is the site you already open, to feed the transcript to the model. It is limited strictly to real YouTube hosts. This fetch runs in the content script (the page own context, same-origin with the video page), so it is gated by `optional_host_permissions` (`*://*.youtube.com/*`, `*://*.googlevideo.com/*`, asked on demand) and `activeTab` instead of by the extension-pages `connect-src` list below.
- **Bilibili Subtitles**: On a Bilibili page, the extractor fetches video subtitle metadata from the Bilibili API (`api.bilibili.com`) and the actual subtitle track from the `hdslb.com` CDN. Reading the metadata endpoint needs your Bilibili session cookies (`credentials: "include"`) because Bilibili limits subtitle list access to signed-in sessions. Session cookies are scoped strictly to `api.bilibili.com` API requests, while subtitle content downloads from `hdslb.com` leave out session cookies (`credentials: "omit"`). The request carries only the video public IDs. Videos without subtitles fall back to a description-only summary.
- **Bluesky Thread Fetch**: On a Bluesky (`bsky.app`) post page, the extractor fetches the thread from the public AT Protocol endpoint `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread` to get the fully nested reply tree without auth. The request carries only the public `at://` URI of the post (taken from the URL you already view) and falls back to local DOM parsing when offline or blocked, with no cookies or page content beyond the post ID.
- **YouTube Sponsor Segment Lookup (SponsorBlock)**: When summarizing a YouTube video, Apogee asks the crowdsourced SponsorBlock API (`sponsor.ajay.app`) which parts of the video are sponsor reads or self-promotion, so they can be cut from the transcript. This uses the SponsorBlock privacy-saving k-anonymity endpoint where only the first 4 hex chars of the SHA-256 hash of the video ID are sent (never the video ID, URL, or any page content), and the match is picked out locally. If the lookup fails or the video has no SponsorBlock data, a local phrase heuristic runs instead, with no network call at all. The lookup is on by default and can be turned off under Settings > Privacy ("Stay fully local"). Then no request is made and the local heuristic does the stripping on its own.
- **Enforced Connection Allow-List**: No other outside calls exist. The `connect-src` in `apogee-extension/manifest.json` is the exact allow-list enforced against extension pages (popup, background, offscreen). Content-script fetches (YouTube transcripts above) run in the page own context instead, so they are bound by the extractor host allow-list plus `optional_host_permissions`/`activeTab`, as stated per item. `validateOllamaHost` in `apogee-extension/lib/util/ollamaHost.js` limits Local Ollama links only to loopback hosts (`http://127.0.0.1` or `http://localhost`) with strict port checks (default port 11434).

## Executable Code and WASM Runtime Security

Each piece of runnable code, JavaScript and WebAssembly alike, ships inside the extension package. That includes the `onnxruntime-web` WASM runtime (used by Ask local embedding model and the Transformers.js engine) and WebLLM per-model WASM kernels, which are downloaded and SHA-256 checked at build time (see `apogee-extension/scripts/model-libs.mjs`) instead of fetched from a CDN or GitHub at runtime. Only model weights (data files, not runnable code) are fetched at runtime from Hugging Face as stated above.

## Client-Side PDF Text Parsing

PDF text extraction runs fully client-side with `pdf.js` bundled straight into the extension. A PDF opened in a tab is downloaded using that tab network context. A PDF picked or dropped into the popup is read straight from the local `File` object. Only pulled text is handed to the model. The file itself never passes through any other process.

## Client-Side DOCX and Text Input

DOCX files picked or dropped into the popup are parsed locally from their ZIP/XML structure without a document-conversion service or heavy parser dep. Text, Markdown, JSON, and HTML files, plus pasted text, are also read locally. These inputs go only to the picked on-device engine or the clearly set loopback Ollama/llama.cpp server.

## Local Ollama Connection Architecture

To reach Ollama, Apogee strips the `Origin` header from its `localhost` and `127.0.0.1` requests with a `declarativeNetRequest` rule (scoped only to those loopback hosts), so Ollama accepts them without any `OLLAMA_ORIGINS` env var setup. Where the browser supports session-scoped rules, the rule is set at runtime for requests that come from no tab at all (the extension own background fetches), so a page you have open from a local dev server keeps its `Origin` header and the CSRF guards of your other local services stay intact. The bundled static rule stays as a fallback for runtimes without session-rule support and also leaves out `localhost` and `127.0.0.1` as initiators. This is a local on-device request path, not a data path to any third party. Ollama itself only binds to `127.0.0.1` by default, so it is never reachable from your network at all.

## Telemetry and Analytics Policy

Apogee ships no Google Analytics, Mixpanel, crash-reporting SDKs, or telemetry of any kind. No usage data or perf metrics are collected.

## Activity & Privacy Audit View

Settings includes an **Activity & Privacy Audit** panel that gives full visual insight into local runs:

- **Network Egress Verification**: When the SponsorBlock lookup is turned off, it confirms that zero network egress requests were sent during inference (100% on-device local run). If not, it reports local runs with the optional SponsorBlock lookup on.
- **Page Access Audit Log**: Shows a clear, capped log of recent page extractions (title, URL, content char length, page type, and timestamp).
- **Storage Retention Audit**: Shows active cache storage use and history retention policies.

## Local Data Storage Controls

- **Cached Summaries and Page Text**: To make reopening the popup instant, Apogee caches summaries, suggested prompts, pulled page text for articles, and your recent questions and answers in local extension storage (`chrome.storage.local`). This data is never sent and is capped in size. Web content is keyed by a truncated SHA-256 of its URL. Pasted and local-file summaries use a content-derived local identity and do not invent a web origin.
- **Sensitive Sites Exclusion List**: Sensitive sites are never cached. Pages on known webmail and messaging hosts (Gmail, Outlook, Proton Mail, Yahoo Mail, Google Messages, WhatsApp Web, Telegram Web, Slack, Discord, Microsoft Teams) are always treated as short-lived no matter your settings. This is a fixed list, not content detection. Under Settings > Privacy, you can name your own hosts (one per line) to be treated the same way, such as a bank, a health portal, your own mail server, or a smaller webmail provider. A host you add also covers its subdomains. Anything on neither list is cached like any other page unless you pick "Don't save".
- **Session-Only Storage and On-Demand Clearing**: Under Settings > Privacy, you can pick "Don't save (this session only)" so nothing page-derived is written to disk, and clicking "Clear cached summaries & page data" wipes all cached content on demand while keeping your prefs.
- **Model Weights Storage**: Model weights are stored locally in standard browser cache structures and are never sent.

## Browser Permission Sandboxing

Apogee asks for a tight set of browser permissions to enforce security sandboxes:

- **`activeTab` and `scripting`**: Apogee cannot read your browsing history or check other open tabs. It reads the current active tab only when you click Summarize or Ask, right-click and pick "Summarize this page", or use the keyboard shortcut. Local files and pasted text are read only after you pick or give them in the popup.
- **`storage`**: Holds your prefs plus the local cache stated above.
- **`unlimitedStorage`**: Lifts the default quota on `chrome.storage.local` so cached summaries and page text are not dropped under normal storage pressure. It grants no access to anything beyond that cache.
- **`offscreen` (Chrome and Edge only)**: Runs the in-browser WebLLM engine in a hidden document, since a service worker cannot reach WebGPU straight, and also runs the Transformers.js engine there when picked, since a service worker cannot load it reliably either. Not used, and not asked for, in the Firefox build, where Transformers.js runs straight in the background page instead.
- **`sidePanel` (Chrome and Edge only)**: Lets you keep the current Apogee local interface open next to the page instead of in the short-lived toolbar popup. It grants no page or network access and is not asked for in the Firefox build.
- **`alarms`**: Schedules the housekeeping timers that close the idle in-browser model and clean up finished request buffers. These timers live on when the background worker is paused between uses. No user data is involved.
- **`declarativeNetRequestWithHostAccess`**: Backs the rule that strips the `Origin` header from loopback Ollama requests. Where session-scoped rules are supported it is set at runtime for requests from no tab (the extension own background fetches), so site pages keep their `Origin` headers. The bundled static rule stays as a fallback, scoped to `127.0.0.1` and `localhost` with loopback initiators left out. It grants header rewriting only on hosts the extension already has access to.
- **Host & Optional Host Permissions**: Apogee holds standing host access only to local loopback hosts (`http://127.0.0.1` and `http://localhost`) for your local Ollama instance. Site-specific cross-origin domains (such as `*.bilibili.com`, `*.hdslb.com`, `*.youtube.com`, `*.googlevideo.com`, `*.bsky.app` (which covers the `public.api.bsky.app` thread endpoint), and `sponsor.ajay.app`) are stated as `optional_host_permissions` in `manifest.json` and are checked or asked on-demand when features needing those surfaces run. Each other site is reached strictly on-demand through `activeTab` when you click Summarize or Ask. There is zero `<all_urls>` standing access.
- **`contextMenus`**: Adds the "Summarize this page" right-click menu entry. It grants no view into your browsing beyond the page you right-clicked on, which `activeTab` already covers.
- **`notifications`**: Shows a local OS note when a summary started by right-click or keyboard shortcut ends or fails, so you know it is ready without keeping the popup open. Purely local UI. No data leaves your device to show it.
