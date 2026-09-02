# Apogee Privacy and Security Architecture

Privacy is the core pillar of Apogee. The key guarantee is simple: your page content and the summaries or answers generated from it are never sent to any cloud service or third party. Inference happens on your own device via WebGPU or WebAssembly, or on your own machine via local loopback to Ollama (`http://127.0.0.1`). The details below are precise about the few network requests that do occur and what is kept on disk.

## Where Inference Happens

- **In-Browser mode**: Tokenization and inference run entirely on your local device, on the GPU via WebGPU (WebLLM, default on Chrome and Edge) or on the CPU via WebAssembly (Transformers.js, default on Firefox and available as an opt-in on Chrome and Edge). Your page content and summaries are never transmitted anywhere.
- **Local llama.cpp mode**: Page content travels exclusively over local loopback (`http://127.0.0.1`) to your own `llama-server` process, never to the cloud, the same way Local Ollama mode works. Apogee refuses any host that is not `127.0.0.1` or `localhost`, so a remote server cannot be configured even deliberately. If the server was started with `--api-key`, the key is stored alongside your other settings, sent only to that loopback address, and reported in diagnostics as `set` or `unset` rather than by value.
- **Local Ollama mode**: Page content travels exclusively over local loopback (`http://127.0.0.1`) directly to your own Ollama instance HTTP API, never to the cloud. There is no intermediate backend process in the path; the extension is Ollama only client-side hop.

## Outbound Network Connection Details

Apogee makes only a minimal set of outbound network requests:

- **Model Weight Downloads**: Model weights are downloaded once from Hugging Face in in-browser mode, or pulled by Ollama in local mode, then cached and reused offline. This transfers no page content, only the model weight files themselves.
- **YouTube Transcripts**: On a YouTube page, the extractor fetches that video caption track from YouTube or Google endpoints (`youtube.com`, `google.com`, or `googlevideo.com`), which is the site you are already on, to feed the transcript to the model. It is restricted strictly to genuine YouTube and Google hosts.
- **Bilibili Subtitles**: On a Bilibili page, the extractor fetches video subtitle metadata from Bilibili's API (`api.bilibili.com`) and the actual subtitle track from the `hdslb.com` CDN. Querying the metadata endpoint requires your Bilibili session cookies (`credentials: "include"`) because Bilibili restricts subtitle list access to authenticated sessions. Session cookies are strictly scoped to `api.bilibili.com` API requests, while subtitle content downloads from `hdslb.com` explicitly omit session cookies (`credentials: "omit"`). The request carries only the video's public IDs. Videos without available subtitles fall back to a description-only summary.
- **Bluesky Thread Fetch**: On a Bluesky (`bsky.app`) post page, the extractor fetches the thread from the public AT Protocol endpoint `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread` to retrieve the fully-nested reply tree without authentication. The request carries only the public `at://` URI of the post (derived from the URL you are already viewing) and falls back to local DOM parsing when offline or blocked, with no cookies or page content beyond the post identifier.
- **YouTube Sponsor Segment Lookup (SponsorBlock)**: When summarizing a YouTube video, Apogee asks the crowdsourced SponsorBlock API (`sponsor.ajay.app`) which parts of the video are sponsor reads or self-promotion, so they can be stripped from the transcript. This uses SponsorBlock privacy-preserving k-anonymity endpoint where only the first 4 hex characters of the SHA-256 hash of the video ID are sent (never the video ID, URL, or any page content), and the matching entry is picked out locally. If the lookup fails or the video has no SponsorBlock data, a local phrase heuristic runs instead, with no network call at all. The lookup is on by default and can be switched off under Settings under Privacy ("Stay fully local"), in which case no request is made and the local heuristic does the stripping on its own.
- **Enforced Connection Allow-List**: There are no other external calls. See the content security policy `connect-src` in `manifest.json` for the exact allow-list this is enforced against, and `validateOllamaHost` in `lib/util/ollamaHost.js`, which restricts Local Ollama connections exclusively to loopback hosts (`http://127.0.0.1` or `http://localhost`) with strict port validation (defaulting to port 11434).

## Executable Code and WASM Runtime Security

Every piece of executable code, JavaScript and WebAssembly alike, ships inside the extension package. That includes the `onnxruntime-web` WASM runtime (used by Ask local embedding model and the Transformers.js engine) and WebLLM per-model WASM kernels, which are downloaded and SHA-256 verified at build time (see `apogee-extension/scripts/model-libs.mjs`) rather than fetched from a CDN or GitHub at runtime. Only model weights (data files, not executable code) are fetched at runtime from Hugging Face as described above.

## Client-Side PDF Text Parsing

PDF text extraction runs fully client-side using `pdf.js` bundled directly into the extension. A PDF opened in a tab is downloaded using that tab's network context; a PDF selected or dropped into the popup is read directly from the local `File` object. Only extracted text is handed to the model; the file itself never passes through any other process.

## Client-Side DOCX and Text Input

DOCX files selected or dropped into the popup are parsed locally from their ZIP/XML structure without a document-conversion service or heavyweight parser dependency. Text, Markdown, JSON, and HTML files, along with pasted text, are also read locally. These inputs are sent only to the selected on-device engine or the explicitly configured loopback Ollama/llama.cpp server.

## Local Ollama Connection Architecture

To reach Ollama, Apogee strips the `Origin` header from its `localhost` and `127.0.0.1` requests via a bundled `declarativeNetRequest` rule (scoped exclusively to those loopback hosts), so Ollama accepts them without requiring any `OLLAMA_ORIGINS` environment variable configuration. The rule also excludes `localhost` and `127.0.0.1` as an initiator, so it only ever touches Apogee own requests. A page you have open from a local development server keeps its `Origin` header, and the CSRF defenses of your other local services are left intact. This is a local on-device request path, not a data transmission path to any third party. Ollama itself only binds to `127.0.0.1` by default, so it is never reachable from your network regardless.

## Telemetry and Analytics Policy

Apogee includes no Google Analytics, Mixpanel, crash-reporting SDKs, or telemetry of any kind. No usage data or performance metrics are collected.

## Activity & Privacy Audit View

Settings includes an **Activity & Privacy Audit** panel that provides full visual transparency into local execution:

- **Network Egress Verification**: Confirms that zero network egress requests were sent during inference (100% on-device local execution).
- **Page Access Audit Log**: Displays a transparent, capped log of recent page extractions (title, URL, content character length, page type, and timestamp).
- **Storage Retention Audit**: Displays active cache storage usage and history retention policies.

## Local Data Storage Controls

- **Cached Summaries and Page Text**: To make reopening the popup instant, Apogee caches summaries, suggested prompts, extracted page text for articles, and your recent questions and answers in local extension storage (`chrome.storage.local`). This data is never transmitted and is capped in size. Web content is keyed by a truncated SHA-256 of its URL; pasted and local-file summaries use a content-derived local identity and do not invent a web origin.
- **Sensitive Sites Exclusion List**: Sensitive sites are never cached. Pages on known webmail and messaging hosts (Gmail, Outlook, Proton Mail, Yahoo Mail, Google Messages, WhatsApp Web, Telegram Web, Slack, Discord, Microsoft Teams) are always treated as ephemeral regardless of your settings. This is a fixed list, not content detection. Under Settings under Privacy, you can name your own hosts (one per line) to be treated the same way, such as a bank, a health portal, your own mail server, or a smaller webmail provider. A host you add also covers its subdomains. Anything on neither list is cached like any other page unless you switch to "Don't save".
- **Session-Only Storage and On-Demand Clearing**: Under Settings under Privacy, you can switch to "Don't save (this session only)" so nothing page-derived is written to disk, and clicking "Clear cached summaries & page data" wipes all cached content on demand while preserving your preferences.
- **Model Weights Storage**: Model weights are stored locally in standard browser cache structures and are never transmitted.

## Browser Permission Sandboxing

Apogee requests a precise set of browser permissions to enforce security sandboxes:

- **`activeTab` and `scripting`**: Apogee cannot read your browsing history or inspect other open tabs. It reads the currently active tab only when you click Summarize or Ask, right-click and choose "Summarize this page", or use the keyboard shortcut. Local files and pasted text are read only after you select or provide them in the popup.
- **`storage`**: Holds your preferences plus the local cache described above.
- **`unlimitedStorage`**: Lifts the default quota on `chrome.storage.local` so cached summaries and page text are not evicted under normal storage pressure. It does not grant access to anything beyond that cache.
- **`offscreen` (Chrome and Edge only)**: Runs the in-browser WebLLM engine in a hidden document, since a service worker cannot access WebGPU directly, and also runs the Transformers.js engine there when selected, since a service worker cannot reliably load it either. Not used, and not requested, in the Firefox build, where Transformers.js runs directly in the background page instead.
- **`sidePanel` (Chrome and Edge only)**: Lets you keep Apogee's existing local interface open beside the page instead of in the temporary toolbar popup. It grants no page or network access and is not requested in the Firefox build.
- **`alarms`**: Schedules the housekeeping timers that close the idle in-browser model and clean up finished request buffers. These timers survive the background worker being suspended between uses. No user data is involved.
- **`declarativeNetRequestWithHostAccess`**: Backs the single bundled rule that strips the `Origin` header from loopback Ollama requests. The rule is scoped to `127.0.0.1` and `localhost` only, excludes requests initiated by local pages so it cannot weaken another local service, and grants header rewriting exclusively on hosts the extension already has access to.
- **Host & Optional Host Permissions**: Apogee holds standing host access exclusively to local loopback hosts (`http://127.0.0.1` and `http://localhost`) for your local Ollama instance. Site-specific cross-origin domains (such as `*.bilibili.com`, `*.hdslb.com`, `*.youtube.com`, `*.bsky.app`, `public.api.bsky.app`, and `sponsor.ajay.app`) are declared as `optional_host_permissions` in `manifest.json` and are checked or requested on-demand when features needing those surfaces are invoked. Every other site is accessed strictly on-demand through `activeTab` when you click Summarize or Ask. There is zero `<all_urls>` standing access.
- **`contextMenus`**: Adds the "Summarize this page" right-click context menu entry. It does not grant any visibility into your browsing beyond the page you right-clicked on, which `activeTab` already covers.
- **`notifications`**: Shows a local OS notification when a summary triggered by right-click or keyboard shortcut finishes or fails, so you know it is ready without needing to keep the popup open. Purely local UI; no data leaves your device to show it.
