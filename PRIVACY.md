# Apogee Privacy and Security Architecture

Privacy is the core promise of Apogee. The main guarantee is simple. Your page content, and the summaries or answers made from it, never go to any cloud service or third party. Inference runs on your own device through WebGPU or WebAssembly. It also runs on your own machine through local loopback to Ollama or llama.cpp (`http://127.0.0.1`).

The details below state exactly which few network requests happen. They also state what stays on disk.

## Where Inference Happens

- **In-Browser mode**: Tokenization and inference run fully on your local device. They run on the GPU through WebGPU (WebLLM, default on Chrome and Edge). They also run on the CPU through WebAssembly (Transformers.js, default on Firefox and opt-in on Chrome and Edge). Your page content and summaries never go anywhere.

- **Local llama.cpp mode**: Page content travels only over local loopback (`http://127.0.0.1`) to your own `llama-server` process. It never reaches the cloud. Local Ollama mode works the same way. Apogee refuses any host other than `127.0.0.1` or `localhost`.

  You cannot set a remote server, even on purpose. If the server started with `--api-key`, the key stays with your other settings. Apogee sends it only to that loopback address. Diagnostics show it as `set` or `unset`, never by value.

- **Local Ollama mode**: Page content travels only over local loopback (`http://127.0.0.1`) straight to your own Ollama instance HTTP API. It never reaches the cloud. No middle backend sits in the path. The extension is the only client-side hop to Ollama.

## Outbound Network Connection Details

Apogee makes only a small set of outbound network requests:

- **Model Weight Downloads**: Hugging Face supplies model weights once in in-browser mode. Ollama pulls them in local mode. Apogee caches them and reuses them offline. This sends no page content, only the model weight files.

- **YouTube Transcripts**: On a YouTube page, the content-script extractor fetches the caption track of that video from YouTube endpoints (`youtube.com` or `googlevideo.com`). You already opened that site. The transcript feeds the model. The fetch stays strictly limited to real YouTube hosts.

  It runs in the content script (the context of the page itself, same-origin with the video page). The fetch answers to two gates: `optional_host_permissions` (`*://*.youtube.com/*`, `*://*.googlevideo.com/*`, asked on demand) and `activeTab`. The extension-pages `connect-src` list below does not cover it.

- **Bilibili Subtitles**: On a Bilibili page, the extractor fetches video subtitle metadata from the Bilibili API (`api.bilibili.com`). It fetches the subtitle track itself from the `hdslb.com` CDN. The metadata endpoint needs your Bilibili session cookies (`credentials: "include"`).

  Bilibili limits subtitle list access to signed-in sessions. Session cookies stay strictly scoped to `api.bilibili.com` API requests. Subtitle content downloads from `hdslb.com` leave out session cookies (`credentials: "omit"`).

  The request carries only the public IDs of the video. Videos without subtitles fall back to a description-only summary.

- **Bluesky Thread Fetch**: On a Bluesky (`bsky.app`) post page, the extractor fetches this thread URL.

  `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread`

  It gets the fully nested reply tree without auth. Like the YouTube transcript fetch, this runs in the content script. The fetch answers to two gates: `optional_host_permissions` (`*://*.bsky.app/*`, which covers `public.api.bsky.app`, asked on demand) and `activeTab`.

  The request carries only the public `at://` URI of the post (taken from the URL you already view). It falls back to local DOM parsing when offline, blocked, or denied permission. It sends no cookies and no page content beyond the post ID.

- **Reddit Thread JSON (same-origin page context)**: On a Reddit comments page, the content-script extractor fetches the thread JSON of that page. The address is `{page origin}{page path}.json`, same origin as the comments page you already opened. It gets the fully nested reply tree without auth. Like the YouTube transcript fetch, this runs in the content script in the context of the page itself.

  It reaches no host other than the Reddit page itself. Only `activeTab` covers it. Neither `optional_host_permissions` nor the extension-pages `connect-src` list below covers it. The request sends no cookies (`credentials: "omit"`). It carries no page content beyond the viewed URL. It returns `null` when offline or blocked, and falls back to the generic extractor.

- **YouTube Sponsor Segment Lookup (SponsorBlock)**: When summarizing a YouTube video, Apogee asks the crowdsourced SponsorBlock API (`sponsor.ajay.app`) about sponsor reads and self-promotion. It cuts them from the transcript. This uses the SponsorBlock privacy-saving k-anonymity endpoint. Only the first 4 hex chars of the SHA-256 hash of the video ID go out.

  The video ID, URL, and page content never go out. Apogee picks the match locally. If the lookup fails, or the video has no SponsorBlock data, a local phrase heuristic runs instead. It makes no network call at all.

  The lookup is on by default. Turn it off under Settings, then Privacy ("Stay fully local"). Then no request goes out, and the local heuristic strips sponsor reads on its own.

- **Enforced Connection Allow-List**: No other outside calls exist. The `connect-src` in `apogee-extension/manifest.json` is the exact allow-list enforced against extension pages (popup, background, offscreen). Content-script fetches (YouTube transcripts and the Reddit same-origin thread JSON above) run in the context of the page itself instead. The extractor host allow-list plus `optional_host_permissions` and `activeTab` bind them, as stated per item.

  The single shared loopback validator `validateLoopbackUrl` in `apogee-extension/lib/util/ollamaHost.js` serves the settings UI, the service worker, and the diagnostics display. It limits local links to loopback hosts only (`http://127.0.0.1` or `http://localhost`, IPv6 loopback rejected). It checks ports strictly (default port 11434 for Ollama, 8080 for llama.cpp).

## Executable Code and WASM Runtime Security

Each piece of runnable code, JavaScript and WebAssembly alike, ships inside the extension package. That includes the `onnxruntime-web` WASM runtime (used by the Ask local embedding model and the Transformers.js engine). It also includes WebLLM per-model WASM kernels. Apogee downloads the kernels and SHA-256 checks them at build time (see `apogee-extension/scripts/model-libs.mjs`). It never fetches them from a CDN or GitHub at runtime. Only model weights (data files, not runnable code) come from Hugging Face at runtime, as stated above.

## Client-Side PDF Text Parsing

PDF text extraction runs fully client-side with `pdf.js`, bundled straight into the extension. A PDF opened in a tab downloads through the network context of that tab. Apogee reads a PDF picked or dropped into the popup straight from the local `File` object. Only pulled text reaches the model. The file itself never passes through any other process.

## Client-Side DOCX and Text Input

The popup parses DOCX files picked or dropped into it locally from their ZIP/XML structure. No document-conversion service or heavy parser dep takes part. Apogee also reads text, Markdown, JSON, and HTML files locally, plus pasted text. Picked files cap at 50 MB.

  Pasted or plain-text input caps at 100,000 characters. A note tells you when truncation happens. These inputs go only to the picked on-device engine or the clearly set loopback Ollama/llama.cpp server.

## Local Ollama Connection Architecture

To reach Ollama, Apogee strips the `Origin` header from loopback requests. It targets `localhost` and `127.0.0.1` with a `declarativeNetRequest` rule. The rule stays scoped to those loopback hosts. Ollama then accepts them with no `OLLAMA_ORIGINS` env var setup. Where the browser supports session-scoped rules, the rule applies at runtime to requests from no tab at all.

  Those are the background fetches of the extension itself. A page you have open from a local dev server keeps its `Origin` header. The CSRF guards of your other local services stay intact. The bundled static rule stays as a fallback for runtimes without session-rule support.

  It also leaves out `localhost` and `127.0.0.1` as initiators. This is a local on-device request path, not a data path to any third party. Ollama itself binds to `127.0.0.1` by default. No host on your network reaches it.

## Telemetry and Analytics Policy

Apogee ships no Google Analytics, Mixpanel, crash-reporting SDKs, or telemetry of any kind. Apogee collects no usage data or perf metrics.

## Activity & Privacy Audit View

Settings includes an **Activity & Privacy Audit** panel. It gives full visual insight into local runs:

- **Network Egress Verification**: With the SponsorBlock lookup off, it confirms zero network egress requests during inference (100% on-device local run). Otherwise it reports local runs with the optional SponsorBlock lookup on.

- **Page Access Audit Log**: It shows a clear, capped log of recent page extractions (title, URL, content char length, page type, and timestamp).

- **Storage Retention Audit**: It shows active cache storage use and history retention policies.

## Local Data Storage Controls

- **Cached Summaries and Page Text**: A local cache makes popup reopens fast. Apogee keeps it in extension storage (`chrome.storage.local`). It holds summaries, suggested prompts, pulled page text for articles, and your recent questions and answers. This data never goes out, and size caps apply. Web content keys come from a truncated SHA-256 of the URL.

  Pasted and local-file summaries use a content-derived local identity. They invent no web origin. Reopened past summaries show no clickable links. With no page context to check a link against, every link stays plain text.

- **Sensitive Sites Exclusion List**: Apogee never caches sensitive sites. Pages on known webmail and messaging hosts stay short-lived, no matter your settings.

  The list: Gmail, Outlook, Proton Mail, Yahoo Mail, Google Messages, WhatsApp Web, Telegram Web, Slack, Discord, Microsoft Teams.

  This is a fixed list, not content detection. Under Settings, then Privacy, name your own hosts (one per line) for the same treatment.

  Examples: a bank, a health portal, your own mail server, or a smaller webmail provider. A host you add also covers its subdomains. Anything on neither list follows normal caching, unless you pick "Don't save".

- **Session-Only Storage and On-Demand Clearing**: Under Settings, then Privacy, pick "Don't save (this session only)". Then nothing page-derived reaches disk. Click "Clear cached summaries & page data" to wipe all cached content on demand. Your prefs stay.

- **Model Weights Storage**: Model weights stay in standard browser cache structures locally. They never go out.

## Browser Permission Sandboxing

Apogee asks for a tight set of browser permissions to enforce security sandboxes:

- **`activeTab` and `scripting`**: Apogee cannot read your browsing history or check other open tabs. It reads the current active tab only in three cases. You click Summarize or Ask. You right-click and pick "Summarize this page". You use the keyboard shortcut.

  The popup reads local files and pasted text only after you pick or give them there.

- **`storage`**: It holds your prefs plus the local cache stated above.

- **`unlimitedStorage`**: It lifts the default quota on `chrome.storage.local`. Cached summaries and page text survive normal storage pressure. It grants access to nothing beyond that cache.

- **`offscreen` (Chrome and Edge only)**: It runs the in-browser WebLLM engine in a hidden document. A service worker cannot reach WebGPU straight. It also runs the Transformers.js engine there when picked. A service worker cannot load it reliably either.

  The Firefox build neither uses nor asks for it. Transformers.js runs straight in the background page there instead.

- **`sidePanel` (Chrome and Edge only)**: It keeps the current Apogee local interface open next to the page instead of in the short-lived toolbar popup. It grants no page or network access. The Firefox build does not ask for it.

- **`alarms`**: It schedules the housekeeping timers. They close the idle in-browser model and clean up finished request buffers. These timers live on when the background worker pauses between uses. No user data takes part.

- **`declarativeNetRequestWithHostAccess`**: It backs the rule that strips the `Origin` header from loopback Ollama requests. Where session-scoped rules exist, the rule applies at runtime to requests from no tab. Those are the background fetches of the extension itself.

  Site pages keep their `Origin` headers. The bundled static rule stays as a fallback, scoped to `127.0.0.1` and `localhost` with loopback initiators left out. It rewrites headers only on hosts the extension already reaches.

- **Host & Optional Host Permissions**: Apogee holds standing host access only to local loopback hosts (`http://127.0.0.1` and `http://localhost`) for your local Ollama instance. Site-specific cross-origin domains (such as `*.bilibili.com`, `*.hdslb.com`, `*.youtube.com`, `*.googlevideo.com`, `*.bsky.app` (which covers the `public.api.bsky.app` thread endpoint), and `sponsor.ajay.app`) need listing. They stay listed as `optional_host_permissions` in `manifest.json`. Apogee checks or asks for them on demand when features needing those surfaces run. Where the browser has no permissions API, these gates stay denied instead of failing open.

  Apogee reaches each other site strictly on demand through `activeTab` when you click Summarize or Ask. There is zero `<all_urls>` standing access. Verbatim, the manifest holds `http://127.0.0.1/*` and `http://localhost/*` as standing hosts. It holds `*://*.bilibili.com/*`, `*://*.hdslb.com/*`, `*://*.youtube.com/*`, `*://*.googlevideo.com/*`, `*://*.bsky.app/*`, and `https://sponsor.ajay.app/*` as optional hosts.

- **`contextMenus`**: It adds the "Summarize this page" right-click menu entry. It sees no more of your browsing than the page you right-clicked. `activeTab` already covers that page.

- **`notifications`**: It shows a local OS note when a summary started by right-click or keyboard shortcut ends or fails. You know it is ready without keeping the popup open. Purely local UI. No data leaves your device to show it.
