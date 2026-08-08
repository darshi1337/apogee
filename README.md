<div align="center">

<img alt="" src=".github/assets/apogee-logo.png" width="112">

A **Private, In-Browser AI Summarizer** for your articles, videos, and PDFs. Runs on WebGPU, WebAssembly, or your own local Ollama.

[![Get it on the Chrome Web Store](https://img.shields.io/badge/Chrome_%2F_Edge-Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/apogee/pgemlpomhkdcjjjcpnjlebalnfglomog)
[![Get it on Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-Install-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/apogeeext/)

<a href="https://darshi1337.github.io/apogee/">Website</a> | <a href="#how-it-works">How It Works</a> | <a href="#architecture">Architecture</a> | <a href="#screenshots">Screenshots</a> | <a href="#quick-start">Quick Start</a> | <a href="PRIVACY.md">Privacy</a> | <a href="LICENSE">License</a>

<sub>An offline-first, privacy-respecting browser extension built with ❤︎ by <a href="https://github.com/darshi1337">darshi1337</a> and <a href="https://github.com/darshi1337/apogee/graphs/contributors">contributors</a></sub>

</div>

**Apogee** is an AI browser assistant for articles, videos, emails, and more.
It runs **entirely in your browser**: on your GPU via WebGPU (Chrome, Edge,
and other Chromium browsers) or on your CPU via WebAssembly, which now works
everywhere. WebAssembly is the default on Firefox and an opt-in fallback on
Chromium browsers, useful on machines without WebGPU. No backend, no API
keys, no cloud. Just install the extension and go.

For power users, Apogee also connects directly to a local Ollama instance over `127.0.0.1` to run larger models.

**TL;DR**: Apogee is an offline-first, private AI assistant that runs entirely in your browser, on WebGPU by default in Chromium browsers and on WebAssembly by default in Firefox (also available as an opt-in on Chromium), with zero cloud dependencies or API keys. It summarizes articles, YouTube and Bilibili videos, and PDFs, and answers questions about them using local retrieval, all with complete privacy. Power users can switch to Local Ollama mode to run larger models on their own machine, still with nothing leaving it. Apogee is designed as a fully local, privacy-respecting alternative to cloud-dependent tools like Mozilla's discontinued Orbit.

## Inspiration: Orbit (Killed by Mozilla)

Apogee was inspired by Mozilla's discontinued **Orbit** project (read the [Review of Orbit by Mozilla](https://matduggan.com/review-of-orbit-by-mozilla/)). Orbit attempted to provide browser-based page summarization, but it relied on centralized API servers (Mistral 7B) and cached summaries on the server side using endpoints like `store_result`.

Apogee fixes Orbit's architectural and privacy flaws by being fully local-first:

- **Zero Server Overhead**: Instead of routing queries through remote cloud APIs, Apogee performs tokenization and inference completely on-device via WebGPU.
- **No Data Leaks**: Apogee does not send page content or generated summaries to any external endpoint, your data never leaves your machine.
- **Corporate Independence**: Because Apogee has no server dependencies or cloud infrastructure to pay for, it can never be shut down or sunset.

## How It Works

Apogee runs quantized language models directly in your browser. On Chrome,
Edge, and other Chromium browsers it defaults to
[WebLLM](https://github.com/mlc-ai/web-llm), which executes models on your
GPU via WebGPU. On Firefox, which has no WebGPU offscreen support, it
defaults to [Transformers.js](https://github.com/huggingface/transformers.js)
instead, which runs smaller ONNX models on your CPU via WebAssembly and
performs well on a modern CPU. Transformers.js is also available as an
opt-in alternative in Settings on Chrome and Edge, for machines without
WebGPU or as a lighter-weight option. In every case the first use downloads
the model weights (roughly 270 MB to 2.2 GB depending on the model) and
caches them locally. After that, everything runs offline.

Prefer larger models? Switch to Local Ollama mode and the extension talks
directly to your own Ollama instance over `127.0.0.1`, with no separate
backend to install or run.

**Ask** goes further than the summary itself: instead of blindly truncating
long pages to the first few thousand characters, Apogee embeds the page
locally (a small on-device model, same trust tier as the LLM weights above)
and answers using only the passages most relevant to your question. This
means asking about something buried deep in a long article, PDF, or video
transcript still works, not just what fit in the opening truncated slice.
(Retrieval currently runs on Chromium browsers; Firefox falls back to the
plain truncated slice for now.)

**Highlight-in-page** lets you check the summary against the source: click
any bullet (or line, in Sentences/Paragraphs mode) and Apogee finds the
passage of the original page it's most likely grounded in using the same
on-device retrieval Ask uses, then scrolls to and highlights it in the live
page. Useful for spot-checking a claim without re-reading the whole article.
Chromium-only for now, same constraint as Ask's retrieval above.

**Videos** (YouTube and Bilibili) get their own treatment: Apogee pulls the
video's timestamped transcript and produces a short written gist plus a "Key
moments" timeline, sized to the video's length, where every entry is a
clickable link that seeks the video to that moment. When a video's description
defines real chapters, the summary follows those chapters instead. Sponsor
reads and self-promotion are stripped from YouTube transcripts first (see the
SponsorBlock note under Privacy).

**Custom instructions** (Settings) let you add your own standing guidance, for
example "Explain like I'm five", "Focus on the technical details", or "Answer
in a formal tone", applied on top of Apogee's built-in prompt for every summary
and answer. They sit under the grounding rules (a page can't use them to make
the model invent things), and are capped at 2000 characters. Leave the box
blank to use the defaults unchanged.

## Architecture

Apogee is four cooperating contexts: the popup you see, a service worker that
routes every job and buffers its output, an inference host that actually runs
the model, and extractors injected into the page you are reading. Nothing sits
behind them: there is no backend, and the only bytes that ever leave your
machine are model weights on first run plus two optional lookups noted below.

**Where inference happens** depends on the browser and your settings. Chromium
browsers get an offscreen document (a real `Document` context, which MV3
service workers are not, and which WebGPU and dynamic `import()` both need).
Firefox has no offscreen API, so Transformers.js runs in the background page
instead. Local Ollama mode skips both and streams over HTTP from the service
worker.

### Components and trust boundary

```mermaid
flowchart TD
    subgraph device["Your device"]
        subgraph page["Active tab"]
            EX["Extractors, injected on demand<br/>Readability, YouTube, Bilibili,<br/>Gmail, Reddit, HN, GitHub"]
            HL["Highlight overlay<br/>scrolls to the source passage"]
        end

        subgraph ui["Popup"]
            POPUP["popup.js<br/>Summarize, Ask, Settings"]
        end

        subgraph bg["Service worker"]
            ROUTER["Message router<br/>buffered streams, cancel, finalize"]
        end

        subgraph host["Inference host"]
            WEBLLM["WebLLM, WebGPU<br/>Chromium default"]
            TJS["Transformers.js, WASM/CPU<br/>Firefox default"]
            EMB["all-MiniLM-L6-v2 embeddings<br/>Ask and highlight-in-page"]
        end

        STORE[("chrome.storage.local<br/>summaries, extracted content,<br/>settings, view state")]
        OLLAMA["Ollama on 127.0.0.1:11434<br/>opt-in, larger models"]
    end

    HF["Hugging Face<br/>model weights, first run only"]
    APIS["SponsorBlock, Bilibili API<br/>segment and subtitle lookups"]

    POPUP <==>|"inject, extract, read back"| EX
    POPUP -->|"highlight a claim"| HL
    POPUP <==>|"job out, tokens back"| ROUTER
    ROUTER <==>|"prompt out, tokens back"| host
    ROUTER <==>|"HTTP stream"| OLLAMA
    POPUP <-->|"cache lookup"| STORE
    ROUTER <-->|"persist on completion"| STORE

    host -.->|"download once, cached forever"| HF
    ROUTER -.->|"video pages only"| APIS

    classDef local fill:#e6f4ea,stroke:#1e7e34,color:#12351f
    classDef remote fill:#fff4e0,stroke:#c2680a,color:#4a2905
    class EX,HL,POPUP,ROUTER,STORE,WEBLLM,TJS,EMB,OLLAMA local
    class HF,APIS remote
    style device fill:#f7fdf9,stroke:#1e7e34,stroke-width:2px,stroke-dasharray:6 4,color:#12351f
```

Green is on-device. Amber leaves the device, and it is only ever these two:
public model weights fetched from Hugging Face once and cached forever after,
and, on video pages, a SponsorBlock lookup by video ID (toggleable in Settings)
or Bilibili's own subtitle API for the video you are already watching. Page
content, summaries, and questions are never among them.

### What happens when you hit Summarize

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant P as Popup
    participant Page as Active tab
    participant SW as Service worker
    participant Engine as WebLLM / Transformers.js / Ollama
    participant DB as storage.local

    Note over P,DB: On open, the popup restores from cache first,<br/>keyed by url + format + model + language
    You->>P: Click Summarize
    P->>Page: Inject extractors, read the page
    Page-->>P: Title, clean text (or timestamped transcript)
    P->>DB: Cache extracted content (skipped for sensitive URLs)
    P->>SW: Start job with content, format, language, finalize keys
    SW->>Engine: Clean, chunk, map over chunks, reduce to one summary
    loop While generating
        Engine-->>SW: Token
        SW-->>P: Chunk over a port (buffered, survives popup close)
        P-->>You: Summary streams in
    end
    Engine-->>SW: Done
    SW->>DB: Persist summary, then generate suggested questions
    Note over SW,DB: Finalization lives in the worker, not the popup,<br/>so closing the popup mid-job never loses the result
```

**Ask** takes the same path with one extra step: before prompting, the page is
embedded on-device and only the passages closest to your question are sent to
the model, so an answer buried deep in a long article or transcript is still
reachable. **Highlight-in-page** reuses that same index in reverse, matching a
summary bullet back to the sentence it was grounded in and scrolling the live
page to it. Both need the embedding pipeline in the offscreen document, so both
are Chromium-only for now; Firefox falls back to a plain truncated slice.

## Screenshots

<table>
<thead>
<tr>
<th width="120">Page</th>
<th>Description</th>
<th width="290">Screenshot</th>
</tr>
</thead>
<tbody>

<tr>
<td valign="top"><strong>Home</strong></td>
<td valign="top">
<ul>
<li><strong>Header</strong>: the Apogee wordmark, a status pill showing whether the
selected provider is reachable (green for connected, so an unreachable Ollama or
a browser without WebGPU is visible before you click anything), a sliders icon
that opens Settings, and a close button.</li>
<li><strong>Summarize this page</strong>: the main action. It shows the current
keyboard shortcut inline (<code>Alt+Shift+U</code> by default), read live from
the browser, so remapping or unbinding it at
<code>chrome://extensions/shortcuts</code> is reflected here.</li>
<li><strong>bullets / sentences / paragraphs</strong>: the response format, placed
here rather than in Settings so you can change it in place before summarizing.</li>
<li><strong>Ask Apogee a question</strong>: jumps straight to the question box,
skipping the summary, for when you already know what you want to ask.</li>
<li><strong>Past Summaries</strong>: the eight most recent cached summaries, newest
first. Each card shows the page title and the first line of the summary; click a
card to expand it in place, or use the copy button on the right to copy it
without expanding. The section is hidden entirely when nothing is cached, and
stays empty if you've turned history off under Settings, Privacy.</li>
</ul>
</td>
<td valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/home-dark.png">
  <img alt="Apogee home view: summarize button, response format selector, ask button, and past summaries" src=".github/assets/home-light.png" width="270">
</picture>
</td>
</tr>

<tr>
<td valign="top"><strong>Summary and Ask</strong></td>
<td valign="top">
<ul>
<li><strong>Summary card</strong>: the generated summary, rendered as Markdown in
whichever format you picked. It streams in token by token rather than appearing
all at once. Individual bullets are clickable: Apogee finds the passage of the
live page the bullet is most likely grounded in and scrolls to and highlights it,
so you can check a claim against the source (Chromium browsers only for now).</li>
<li><strong>Two copy buttons</strong> in the card header: the document icon copies
the summary as Markdown, the second copies it as plain text.</li>
<li><strong>Time saved badge</strong>: the source's reading time minus the time to
read the summary. For a video it measures against the real runtime instead of the
transcript's word count, since people speak slower than they read.</li>
<li><strong>Resummarize</strong>: regenerates from the cached page text, useful
after changing format, model, or language. A hint appears above it when one of
those settings has changed since this summary was produced.</li>
<li><strong>Suggested Prompts</strong>: two follow-up questions generated from the
summary, in the background, so they're usually ready by the time you've read it.
The close button collapses the section into a small tag in the chat header.</li>
<li><strong>Ask Apogee</strong>: the question box. Answers are grounded in the
passages of the page most relevant to your question, not just the first few
thousand characters, so questions about material buried deep in a long article,
PDF, or transcript still work. The answer renders below the box with its own copy
button.</li>
<li>On a YouTube or Bilibili page this same view shows a written gist plus a
"Key moments" timeline instead, where each timestamp is a link that seeks the
video.</li>
</ul>
</td>
<td valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/summary-dark.png">
  <img alt="Apogee summary view: rendered summary, time saved badge, suggested prompts, and the ask box" src=".github/assets/summary-light.png" width="270">
</picture>
</td>
</tr>

<tr>
<td valign="top"><strong>Settings</strong></td>
<td valign="top">
<ul>
<li><strong>Status</strong>: the same reachability indicator as the header pill,
with room for the full message.</li>
<li><strong>AI Provider</strong>: In-Browser AI (GPU) via WebGPU, In-Browser AI
(CPU) via Transformers.js, or Local Ollama. Picking Local Ollama swaps the model
card below for an Ollama host field plus a model list populated live from
whatever you've actually pulled, so those two cards are not visible in this
shot.</li>
<li><strong>In-Browser Model</strong>: the model list for the selected in-browser
provider, with download sizes, since first use fetches the weights once and then
caches them offline.</li>
<li><strong>Summary Language</strong>: the output language for summaries, answers,
and suggested prompts. Defaults to English; "Same as article" keeps the page's
own language.</li>
<li><strong>Translation Engine</strong>: whether the summarization model translates
as it writes (the default, no extra download) or a dedicated Opus-MT model does
it (stronger on lower-resource languages, downloads a small model per pair).</li>
<li><strong>Appearance Theme</strong>: dark, light, or follow the system
preference. This is what the two variants of every screenshot on this page
show.</li>
<li><strong>Custom Instructions</strong>: standing guidance applied on top of the
built-in prompt for every summary and answer, capped at 2000 characters with a
live counter. It sits under the grounding rules, so a page cannot use it to make
the model invent things.</li>
<li><strong>SponsorBlock</strong>: whether to look up sponsor segments for YouTube
videos so they can be stripped from the transcript. Switching it off keeps the
session fully local and falls back to an on-device phrase heuristic.</li>
<li><strong>Privacy</strong>: whether summaries and history are written to disk at
all, plus a button that wipes all cached content on demand while keeping
preferences.</li>
<li><strong>Diagnostics</strong>: whether the AI engine records what it is doing
while it loads and generates. Off by default; turn it on before reproducing a
bug and the log panel above the summary collects the run.</li>
<li><strong>Get in touch</strong>: opens the last page.</li>
</ul>
</td>
<td valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/settings-dark.png">
  <img alt="Apogee settings view: provider, model, language, translation engine, theme, custom instructions, SponsorBlock, privacy, and diagnostics controls" src=".github/assets/settings-light.png" width="270">
</picture>
</td>
</tr>

<tr>
<td valign="top"><strong>Get in touch</strong></td>
<td valign="top">
<ul>
<li><strong>Contribute</strong>, <strong>Report a bug</strong>, and
<strong>Request a feature</strong> open the corresponding GitHub pages in a new
tab.</li>
<li>The footer carries the installed version, handy to quote when filing a bug,
and credits <strong>contributors</strong>, linking to the repository's
contributor graph.</li>
</ul>
</td>
<td valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/contact-dark.png">
  <img alt="Apogee contact view: contribute, report a bug, request a feature, and a footer with the version and a contributors credit" src=".github/assets/contact-light.png" width="270">
</picture>
</td>
</tr>

</tbody>
</table>

## Quick Start

1. **Install the extension** (see below).
2. Open any webpage.
3. Click the Apogee icon, then **Summarize this page**.
4. On first use, the model downloads automatically. After that it's instant.

That's it. No backend installation, no terminal commands.

**Response format** (bullets, sentences, or paragraphs) sits right under the
Summarize button on the home view, so you can switch it in place before
summarizing rather than going through Settings.

**Faster ways to summarize**: right-click anywhere on a page and pick
**Summarize this page**, or use the keyboard shortcut (default `Alt+Shift+U`,
remappable at `chrome://extensions/shortcuts`). Either works without opening
the popup at all. A system notification lets you know when it's ready; click
it (or open the popup) to see the result. If you open the popup while it's
still generating, it shows the normal loading view instead of the default
Home page.

### Two Ways to Use Apogee

Apogee offers two modes of operation to balance ease-of-use and raw capabilities:

| In-Browser AI (WebLLM by default on Chrome/Edge, Transformers.js by default on Firefox and opt-in everywhere) | Local Ollama                                                       |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Model Size**: Small, fast models (~270 MB to 2.2 GB)                                                        | **Model Size**: Larger, more capable models (4B to 8B+)            |
| **Setup**: Zero setup required; automatic download on first run                                               | **Setup**: Requires installing Ollama (no separate backend to run) |
| **Execution**: Runs directly in the browser, via WebGPU (WebLLM) or WebAssembly (Transformers.js)             | **Execution**: Extension talks directly to Ollama's HTTP API       |
| **Offline**: Fully offline after model weights are cached                                                     | **Offline**: Fully offline, communicating over `127.0.0.1`         |

## Supported In-Browser Models

### WebLLM (WebGPU, Chrome/Edge)

| Model                   | Download Size | Best For                   |
| ----------------------- | ------------- | -------------------------- |
| Qwen 2.5 1.5B (default) | ~900 MB       | Multilingual summarization |
| SmolLM2 1.7B            | ~1 GB         | General tasks              |
| Llama 3.2 1B            | ~700 MB       | Lightweight, fast          |
| Phi 3.5 Mini            | ~2.2 GB       | Stronger reasoning         |

### Transformers.js (WASM/CPU, default on Firefox, opt-in on Chrome/Edge)

| Model                  | Download Size | Best For                          |
| ---------------------- | ------------- | --------------------------------- |
| SmolLM2 360M (default) | ~270 MB       | Smallest/fastest, quick summaries |
| Qwen 2.5 0.5B          | ~480 MB       | Multilingual                      |
| Llama 3.2 1B           | ~1.2 GB       | Stronger reasoning, slower on CPU |

Runs via [Transformers.js](https://github.com/huggingface/transformers.js)
(ONNX models on the WASM backend). Chosen specifically because it never
spawns a Worker (onnxruntime-web's proxy mode is hardcoded off), unlike
wllama (needs a `blob:`-URL Worker, which both Chrome's and Firefox's
extension CSP block). On Firefox, which has no offscreen document or WebGPU,
it runs directly in the background page and is the only in-browser option.
On Chrome/Edge it runs in the same offscreen document WebLLM uses and is
offered as an opt-in alternative in Settings, useful on machines without
WebGPU. Its own WASM runtime ships bundled inside the extension package
rather than being fetched from a CDN at runtime. Generation is
single-threaded (extension pages aren't cross-origin-isolated, so no
`SharedArrayBuffer`) and context is capped at 4096 tokens to keep latency
reasonable on CPU. On a modern/fast CPU this still summarizes well with the
default SmolLM2 360M model; on older or low-power hardware, expect noticeably
slower generation, and consider switching to **Local Ollama** instead.

## Supported Ollama Models

Any model you've pulled shows up automatically in the extension's settings
(see [Advanced: Local Ollama Mode](#advanced-local-ollama-mode)). These are
just a starting point if you haven't pulled anything yet:

| Model          | Size | Command to pull              | Recommended For               |
| -------------- | ---- | ---------------------------- | ----------------------------- |
| Gemma 3        | ~4B  | `ollama pull gemma3:4b`      | Excellent lightweight tasks   |
| Qwen 3 8B      | ~8B  | `ollama pull qwen3:8b`       | Multi-turn chat & reasoning   |
| Mistral Latest | ~7B  | `ollama pull mistral:latest` | General language capabilities |
| Llama 3.1 8B   | ~8B  | `ollama pull llama3.1:8b`    | General reasoning & coding    |

Summarization also adapts its chunking to the model you pick: larger-context
models (e.g. `llama3.1`, `qwen2.5`, `gemma3`) get bigger chunks and fewer
passes over long content, rather than the same fixed chunk size regardless
of what the model can actually handle.

## Browser Support

Apogee ships two builds: a Chromium build (`dist/chrome`, Manifest V3 with an
offscreen document for WebGPU) and a Firefox build (`dist/firefox`, no
offscreen document). Anything Chromium-based accepts the same build.

| Browser          | WebLLM (In-Browser AI, WebGPU) | Transformers.js (In-Browser AI, WASM) | Local Ollama                                                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome 113+      | Yes, default                   | Yes, opt-in in Settings               | Yes                                                                                                                                                                     | Primary target, most tested                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Edge 113+        | Yes, default                   | Yes, opt-in in Settings               | Yes                                                                                                                                                                     | Chromium-based, same engine as Chrome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Dia              | Yes, default                   | Yes, opt-in in Settings               | Yes                                                                                                                                                                     | Chromium-based                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Brave            | Should work                    | Should work                           | Yes                                                                                                                                                                     | Chromium-based; WebGPU may need enabling in `brave://flags`, not independently verified                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Opera / Opera GX | Should work                    | Should work                           | Yes                                                                                                                                                                     | Chromium-based, not independently verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Vivaldi          | Should work                    | Should work                           | Yes                                                                                                                                                                     | Chromium-based, not independently verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Arc              | Should work                    | Should work                           | Yes                                                                                                                                                                     | Chromium-based, not independently verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Firefox 140+     | No                             | Yes, default                          | Yes                                                                                                                                                                     | Firefox's WebExtensions implementation has no `browser.offscreen` API, which WebLLM needs to run WebGPU outside a visible tab (a service worker can't access WebGPU directly). Transformers.js needs neither WebGPU nor a Worker, so it runs directly in Firefox's background page instead, and is the default in-browser provider there. The Firefox build declares `strict_min_version: 140.0` (needed for the manifest's `data_collection_permissions` key), older Firefox will refuse to install it rather than fail silently. |
| Safari           | No                             | No                                    | Apogee doesn't currently build or ship a Safari extension (a separate packaging toolchain from Chrome/Firefox); not evaluated regardless of Safari's own WebGPU support |

See MDN's [WebGPU API browser compatibility table](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API#browser_compatibility)
for exact per-browser/per-OS WebGPU version support, it's a fast-moving target
and a better source of truth than a number hardcoded here. A GPU with WebGPU
support (most GPUs from the last several years) is required for the
In-Browser (WebLLM) mode specifically. Local Ollama mode has no GPU
requirement of its own beyond whatever Ollama itself needs.

## Translations

Apogee can produce its summaries, Q&A answers, and suggested questions in a
language other than the source page's. Pick an output language under
**Settings, then Summary language**. The default is **English** (summaries come
out in English no matter what language the page is in), and **"Same as
article"** keeps the page's own language. 29 target languages are supported.

Under the hood there are **two translation engines**, selectable under
**Settings, then Translation engine**:

- **LLM (default).** The summarization model translates as it writes: one
  generation pass with a system-level "write in X" directive, the output is
  language-checked, and only if the model slipped does an explicit translate
  pass run. No extra download; it reuses the model already loaded for
  summarizing. Works for every language, but small in-browser models get
  weaker the further a language sits from English.
- **Opus-MT (opt-in).** A dedicated [Helsinki-NLP Opus-MT](https://huggingface.co/Helsinki-NLP)
  translation model. The summary is generated neutrally (in English), then
  translated by a purpose-built model: deterministic, structure-preserving
  (bullets and `[MM:SS](url)` timestamp links are kept intact), and noticeably
  stronger on the low-resource long tail where the summarization LLM is
  weakest. Each model is a small (~80&nbsp;MB) ONNX file downloaded from
  Hugging Face on first use and then cached offline. Any language Opus-MT
  can't reach automatically falls back to the LLM engine.

Opus-MT is English-centric, so it uses one of three tiers per language. The
table below is the **English-to-target** path used when translating a summary:

| Language              | Opus-MT model (English-to-target) | Tier            | Recommended engine |
| --------------------- | --------------------------------- | --------------- | ------------------ |
| Spanish               | `opus-mt-en-es`                   | Dedicated model | Opus or LLM        |
| French                | `opus-mt-en-fr`                   | Dedicated model | Opus or LLM        |
| German                | `opus-mt-en-de`                   | Dedicated model | Opus or LLM        |
| Italian               | `opus-mt-en-it`                   | Dedicated model | Opus or LLM        |
| Dutch                 | `opus-mt-en-nl`                   | Dedicated model | Opus or LLM        |
| Russian               | `opus-mt-en-ru`                   | Dedicated model | Opus or LLM        |
| Chinese (Simplified)  | `opus-mt-en-zh`                   | Dedicated model | Opus or LLM        |
| Japanese              | `opus-mt-en-jap`                  | Dedicated model | Opus or LLM        |
| Ukrainian             | `opus-mt-en-uk`                   | Dedicated model | **Opus**           |
| Czech                 | `opus-mt-en-cs`                   | Dedicated model | **Opus**           |
| Romanian              | `opus-mt-en-ro`                   | Dedicated model | **Opus**           |
| Hungarian             | `opus-mt-en-hu`                   | Dedicated model | **Opus**           |
| Swedish               | `opus-mt-en-sv`                   | Dedicated model | **Opus**           |
| Danish                | `opus-mt-en-da`                   | Dedicated model | **Opus**           |
| Finnish               | `opus-mt-en-fi`                   | Dedicated model | **Opus**           |
| Indonesian            | `opus-mt-en-id`                   | Dedicated model | **Opus**           |
| Portuguese            | `opus-mt-en-mul` (`>>por<<`)      | Grouped model   | **Opus**           |
| Polish                | `opus-mt-en-mul` (`>>pol<<`)      | Grouped model   | **Opus**           |
| Slovenian             | `opus-mt-en-mul` (`>>slv<<`)      | Grouped model   | **Opus**           |
| Bulgarian             | `opus-mt-en-mul` (`>>bul<<`)      | Grouped model   | **Opus**           |
| Greek                 | `opus-mt-en-mul` (`>>ell<<`)      | Grouped model   | **Opus**           |
| Turkish               | `opus-mt-en-mul` (`>>tur<<`)      | Grouped model   | **Opus**           |
| Norwegian             | `opus-mt-en-mul` (`>>nob<<`)      | Grouped model   | **Opus**           |
| Estonian              | `opus-mt-en-mul` (`>>est<<`)      | Grouped model   | **Opus**           |
| Latvian               | `opus-mt-en-mul` (`>>lav<<`)      | Grouped model   | **Opus**           |
| Lithuanian            | `opus-mt-en-mul` (`>>lit<<`)      | Grouped model   | **Opus**           |
| Slovak                | none (LLM only)                   | No Opus model   | LLM (only option)  |
| Korean                | none (LLM only)                   | No Opus model   | LLM (only option)  |
| Chinese (Traditional) | none (LLM only)                   | No Opus model   | LLM (only option)  |

**How to read this:**

- **Dedicated model**: a small, single-pair Opus-MT model (`opus-mt-en-<code>`),
  the highest-quality tier. For well-resourced languages (Spanish, French,
  German, Italian, Dutch, Russian, Chinese, Japanese) the default LLM engine is
  already strong, so either engine works; for the rest, Opus is the better pick.
- **Grouped model**: the multilingual `opus-mt-en-mul` model, steered to the
  target with a `>>code<<` token. These are mostly the lower-resource languages
  the summarization LLM handles least well, so **Opus is recommended**.
- **No Opus model**: Slovak, Korean, and Traditional Chinese have no
  English-to-target Opus-MT path, so they always use the **LLM** engine (choosing
  Opus for these silently falls back to the LLM anyway).

When translating the other direction (a non-English page summarized in
English), Opus-MT uses the matching `opus-mt-<code>-en` dedicated models where
they exist and the grouped `opus-mt-mul-en` catch-all otherwise.
Non-English-to-non-English pairs aren't translated directly and fall back to
the LLM engine.

## Install the Extension

### Chrome, Edge, Brave, Opera, Vivaldi, Arc, Dia

These are all Chromium-based and use the same `dist/chrome` build and load
steps; only the extensions-page URL differs slightly (`chrome://extensions`,
`edge://extensions`, `brave://extensions`, `dia://extensions/`, etc.). The
load steps are identical on **Windows, macOS, and Linux**; only the folder
path you point "Load unpacked" at differs by OS.

1. Download the packaged extension `.zip` from [Releases](https://github.com/darshi1337/apogee/releases).
2. Extract/unzip the downloaded `.zip` file on your machine.
3. Open your browser's extensions page (`chrome://extensions` on Chrome/Brave/Opera/Vivaldi, `edge://extensions` on Edge, `dia://extensions/` on Dia).
4. Enable **Developer mode** (toggle in the top-right).
5. Click **Load unpacked** and select the extracted folder (containing `manifest.json`, not the ZIP file itself).

#### Build from Source (Developer Option)

**Prerequisites** (any OS): [Node.js](https://nodejs.org) 20.19+ or 22.12+ (CI
builds on 22) and npm. The first Chrome build also downloads and SHA-256-verifies
WebLLM's WASM kernels (~21 MB, cached in `apogee-extension/.model-libs-cache/`
afterward), so the initial build needs internet access.

1. Clone this repository.
2. `cd apogee-extension && npm install && npm run build`
3. Go to your browser's extensions page and enable **Developer mode**.
4. Click **Load unpacked** and select the `apogee-extension/dist/chrome` folder.

   > `npm run build` produces both `dist/chrome` and `dist/firefox`. Use `dist/chrome` for any Chromium-based browser and `dist/firefox` for Firefox. You can also build a single target with `npm run build:chrome` or `npm run build:firefox`.

   > **Windows**: the build scripts use POSIX `VAR=value` env-var syntax, which
   > native `cmd.exe` and PowerShell don't understand. Easiest fix: run the build
   > from **Git Bash** or **WSL**, where `npm run build` works unchanged. If you'd
   > rather stay in your native shell, invoke Vite directly with that shell's own
   > syntax. PowerShell: `$env:TARGET_BROWSER="chrome"; npx vite build`; cmd:
   > `set TARGET_BROWSER=chrome && npx vite build` (repeat with `firefox` for the
   > Firefox target). macOS and Linux use the npm scripts as-is.

### Firefox

You can install Apogee directly from [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/apogeeext/) or download the package from [Releases](https://github.com/darshi1337/apogee/releases).

Firefox works out of the box: in-browser AI runs via Transformers.js on
WebAssembly (SmolLM2 360M by default, no setup needed). On older or
low-power CPUs, generation can be slow, switch to **Local Ollama** mode in
settings for faster results with larger models.

## Advanced: Local Ollama Mode

If you prefer running larger models (8B+) locally through Ollama, Apogee talks
to it **directly over HTTP**; there's no separate backend server to install
or keep running.

### 1. Install Ollama

Install Ollama for your OS, then pull the models you want:

- **macOS**: download the app from [ollama.com/download](https://ollama.com/download), or `brew install ollama`.
- **Windows**: download and run the installer from [ollama.com/download](https://ollama.com/download).
- **Linux**: `curl -fsSL https://ollama.com/install.sh | sh`

```bash
ollama pull gemma3:4b   # and qwen3:8b, mistral:latest, llama3.1:8b
```

### 2. Point the extension at Ollama

Open the extension, go to Settings, and select **Local Ollama**. The host
field defaults to `http://127.0.0.1:11434` (Ollama's own default port),
only change it if you've configured Ollama to listen elsewhere.

**No CORS or `OLLAMA_ORIGINS` setup is needed.** Apogee connects to Ollama
directly: a bundled [declarativeNetRequest](apogee-extension/rules/ollama-cors.json)
rule strips the `Origin` header from its `localhost` / `127.0.0.1` requests, so
Ollama treats them as same-origin and serves them out of the box. Just start
Ollama and go.

Once connected, the model list is populated live from whatever you've
actually pulled (via Ollama's own `/api/tags`), not a fixed list, so any
model you `ollama pull` shows up automatically. If Ollama isn't reachable
yet, a small default list is shown instead so you can still pick a model
before starting it.

That's it: no `apogee-backend`, no separate server process to manage.

## Performance Benchmarks

### In-Browser AI (WebGPU)

- **Generation Throughput**: ~30 to 50 tokens/s (GPU dependent)
- **Model Cold-load**: ~1 to 3 seconds (once cached in browser storage)
- **First-run Cache Download**: ~1 to 3 minutes depending on network bandwidth (to download the ~700 MB to 2.2 GB model weights)

### Local Ollama

Measured locally on an Apple M2 (`gemma3:4b`, GPU via Metal):

| Metric                              | Value                              |
| ----------------------------------- | ---------------------------------- |
| Generation throughput               | ~73 tokens/s                       |
| Model cold-load                     | ~0.25 s                            |
| Short page / question               | ~1 to 1.5 s end to end             |
| Long page (~40k chars, multi-chunk) | first bullets in ~2 s, ~12 s total |

## Privacy & Permissions

Privacy is the core pillar of Apogee. The key guarantee is simple: **your page content and the summaries/answers generated from it are never sent to any cloud service or third party.** Inference happens on your own device (WebGPU) or your own machine (`127.0.0.1` Ollama). The details below are precise about the few network requests that do occur and what is kept on disk.

- **Where inference happens**:
  - **In-Browser mode**: Tokenization and inference run entirely on your local device, on the GPU via WebGPU (WebLLM, default on Chrome/Edge) or on the CPU via WebAssembly (Transformers.js, default on Firefox and available as an opt-in on Chrome/Edge). Your page content and summaries are never transmitted anywhere.
  - **Local Ollama mode**: Page content travels exclusively over local loopback (`127.0.0.1`) directly to your own Ollama instance's HTTP API, never to the cloud. There is no intermediate backend process in the path, the extension is Ollama's only client-side hop.
- **The only outbound network requests Apogee makes**:
  - **Model weights** are downloaded once from **Hugging Face** (in-browser mode) or pulled by **Ollama** (local mode), then cached and reused offline. This transfers no page content, only the model files themselves.
  - **YouTube transcripts**: on a YouTube page, the extractor fetches that video's caption track from YouTube/Google (the site you're already on) to feed the transcript to the model. It is restricted to genuine `youtube.com`/`google.com`/`googlevideo.com` hosts.
  - **Bilibili subtitles**: on a Bilibili page, the extractor fetches that video's subtitle track from Bilibili's own endpoints (`api.bilibili.com` and the `hdslb.com` subtitle CDN, the site you're already on). Unlike the YouTube caption fetch, this request is sent with your Bilibili cookies, because Bilibili only exposes subtitle URLs to a signed-in session; it carries only the video's own IDs. A video with no subtitles falls back to a description-only summary.
  - **YouTube sponsor-segment lookup (SponsorBlock)**: when summarizing a YouTube video, Apogee asks the crowdsourced [SponsorBlock](https://sponsor.ajay.app) API which parts of the video are sponsor reads/self-promo, so they can be stripped from the transcript. This uses SponsorBlock's privacy-preserving k-anonymity endpoint: only the first 4 hex characters of the SHA-256 hash of the video ID are sent (never the video ID, URL, or any page content), and the matching entry is picked out locally. If the lookup fails or the video has no SponsorBlock data, a local phrase heuristic runs instead, with no network call at all. The lookup is on by default and can be switched off under Settings, Privacy ("Stay fully local"), in which case no request is made and the local heuristic does the stripping on its own.
  - That's it, there are no other external calls. (See the extension's `content_security_policy.connect-src` in `manifest.json` for the exact allow-list this is enforced against, and `ALLOWED_OLLAMA_HOSTS` in `background/service-worker.js`, which rejects any Local Ollama host setting that isn't plain `http://127.0.0.1` or `http://localhost`.)
- **No remotely loaded code**: every piece of executable code, JavaScript and WebAssembly alike, ships inside the extension package. That includes onnxruntime-web's WASM runtime (Ask's local embedding model and the Transformers.js engine) and WebLLM's per-model WASM kernels, which are downloaded and SHA-256-verified at **build** time (see `apogee-extension/scripts/model-libs.mjs`) rather than fetched from a CDN or GitHub at runtime. Only model _weights_ (data, not code) are fetched at runtime, from Hugging Face, as described above.
- **PDFs**: PDF text extraction runs fully client-side using `pdf.js` bundled into the extension, the PDF is downloaded straight into the browser tab (using that tab's own network context) and parsed there. Only the extracted text is ever handed to the model; the file itself never passes through any other process.
- **Local Ollama connection**: to reach Ollama, Apogee strips the `Origin` header from its `localhost` / `127.0.0.1` requests via a bundled [declarativeNetRequest](apogee-extension/rules/ollama-cors.json) rule (scoped to those loopback hosts only), so Ollama accepts them without any `OLLAMA_ORIGINS` configuration. This is a local, on-device request path, not a data-transmission path to any third party. Ollama itself only binds to `127.0.0.1` by default, so it's never reachable from your network regardless.
- **No Telemetry, Tracking, or Analytics**: Apogee includes no Google Analytics, Mixpanel, crash-reporting SDKs, or telemetry of any kind. No usage data is collected.
- **What's stored on your device (and how to control it)**:
  - To make reopening the popup instant, Apogee caches **summaries, suggested prompts, extracted page text (for articles), and your recent questions/answers** in local extension storage (`chrome.storage.local`), never transmitted, capped in size, and keyed by a truncated SHA-256 of the URL (so URLs with session tokens in their query strings aren't stored in plaintext keys, and the key can't be walked back to the URL it came from).
  - **Sensitive sites are never cached**, pages on known webmail/messaging hosts (Gmail, Outlook, Proton Mail, Yahoo Mail, Google Messages, WhatsApp Web, Telegram Web, Slack, Discord, Microsoft Teams) are always treated as ephemeral, regardless of your setting. This is a fixed allow-list, not content detection: private pages on hosts _not_ listed (e.g. a bank, a health portal, a smaller webmail provider) are cached like any other page unless you switch to "Don't save" below.
  - Under **Settings, Privacy**, you can switch to **"Don't save (this session only)"** so nothing page-derived is written to disk, and **"Clear cached summaries & page data"** wipes all cached content on demand (your preferences are kept).
- **Browser Permission Sandboxing**:
  - **`activeTab` + `scripting`**: Apogee cannot read your browsing history or inspect other open tabs. It reads the _currently active tab_ only when you click "Summarize"/"Ask", right-click and choose "Summarize this page", or use the keyboard shortcut.
  - **`storage`**: Holds your preferences plus the local cache described above.
  - **`unlimitedStorage`**: Lifts the default quota on `chrome.storage.local` so the cached summaries/page text above aren't evicted under normal storage pressure, it does not grant access to anything beyond that cache.
  - **`offscreen`** (Chrome/Edge only): Runs the in-browser WebLLM engine in a hidden document, since a service worker can't access WebGPU directly, and also runs the Transformers.js engine there when it's selected, since a service worker can't reliably load it either. Not used, and not requested, in the Firefox build, where Transformers.js runs directly in the background page instead.
  - **`alarms`**: Schedules the housekeeping timers that close the idle in-browser model and clean up finished request buffers, these need to survive the extension's background worker being suspended between uses. No user data is involved.
  - **`declarativeNetRequestWithHostAccess`**: Backs the single bundled rule that strips the `Origin` header from loopback Ollama requests (see "Local Ollama connection" above). The rule is scoped to `127.0.0.1`/`localhost` only, and this permission grants header rewriting exclusively on hosts the extension already has access to.
  - **Host permissions**: Apogee holds standing access to exactly two kinds of host, `http://127.0.0.1` / `http://localhost` for your own Ollama, and `*.bilibili.com` / `*.hdslb.com` for the subtitle fetch described above. Every other site is read only at the moment you invoke Apogee on it, through `activeTab`. There is no `<all_urls>` access.
  - **`contextMenus`**: Adds the "Summarize this page" right-click entry. Doesn't grant any visibility into your browsing beyond the page you right-clicked on, which `activeTab` already covers.
  - **`notifications`**: Shows a local OS notification when a right-click/keyboard-shortcut-triggered summary finishes or fails, so you know it's ready without needing to keep the popup open. Purely local UI, no data leaves your device to show it.
- **Model weights** are stored in standard browser cache structures locally and never transmitted.

## Development

```bash
cd apogee-extension
npm install
npm run dev    # watch mode, rebuilds on changes
```

Load the `dist/chrome` folder (or `dist/firefox`) as an unpacked extension in your browser.

Before opening a PR, see [CONTRIBUTING.md](CONTRIBUTING.md) for the lint/format/test/build checks CI runs.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)

UI icons, the GitHub mark included, are drawn for this project on one duotone construction and inlined as SVG (`apogee-extension/popup/icons.js`, `docs/app.js`). The popup and the site render in Mozilla Headline and Mozilla Text (SIL OFL 1.1, © Mozilla Foundation); [Metropolis](https://github.com/chrismsimpson/Metropolis) (Unlicense) is still in `assets/fonts` from an earlier design but is no longer referenced, so it isn't emitted into the built extension. See [`apogee-extension/assets/fonts/LICENSE.md`](apogee-extension/assets/fonts/LICENSE.md).
