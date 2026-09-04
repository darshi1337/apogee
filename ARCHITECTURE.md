# Apogee Architecture

Apogee is an offline-first browser extension built for full data privacy. All text analysis, summarization, and question answering runs on your own machine, using in-browser AI engines or a local Ollama server.

## Overview

Apogee uses four cooperating execution contexts. They talk to each other with standard WebExtension messaging.

- **Popup / Side Panel UI**: The same interface runs in the short-lived toolbar popup or, on Chromium, a persistent side panel. Use it to start summaries, pick output formats, ask follow-up questions, and search past summaries.
- **Service Worker**: The central router. It coordinates tasks, buffers streaming tokens, manages background alarms, and saves results to local storage.
- **Inference Host**: The place where AI models run. On Chromium browsers, this is a dedicated offscreen document with WebGPU and WebAssembly support. On Firefox, models run inside the background page.
- **Content Extractors**: Focused scripts injected into active tabs to clean page content, parse transcripts, handle structured data, or read PDF documents. Popup-side extractors also parse dropped PDF and DOCX files without a tab.

## How It Works

Apogee runs compact language models straight in your browser. On Chrome, Edge, and other Chromium browsers it defaults to WebLLM, which runs models on your GPU through WebGPU. On Firefox, which has no WebGPU offscreen support, it defaults to Transformers.js instead, which runs smaller ONNX models on your CPU through WebAssembly and works well on a modern CPU. Transformers.js is also an opt-in choice in Settings on Chrome and Edge, for machines without WebGPU or as a lighter option. In all cases the first use downloads the model weights (about 270 MB to 2.2 GB based on the model) and caches them locally. After that, all runs work offline.

Prefer larger models, or already run `llama.cpp` yourself? Switch to Local llama.cpp mode and the extension talks to your own `llama-server` over 127.0.0.1. It reads the context window the server reports instead of guessing one from the model name. See the [Local llama.cpp Guide](LLAMACPP.md).

Prefer larger models? Switch to Local Ollama mode and the extension talks straight to your own Ollama instance over 127.0.0.1, with no extra backend to install or run.

Ask goes further than the summary itself: instead of cutting long pages down to the first few thousand characters, Apogee embeds the page locally (a small on-device model, same trust level as the LLM weights above) and answers using only the passages most relevant to your question. So questions about details buried deep in a long article, PDF, or video transcript still work, not just what fit in the opening slice. (Retrieval currently runs on Chromium browsers. Firefox falls back to the plain truncated slice for now.)

Pasted text and local files use the same summarization path as a page, but they need no tab URL. PDF text is pulled out with bundled `pdf.js`. DOCX text is pulled out offline from the document ZIP/XML structure. Local inputs get a content-derived cache identity instead of a made-up web origin.

Highlight-in-page lets you check the summary against the source: click any bullet (or line, in Sentences/Paragraphs mode) and Apogee finds the passage of the original page it most likely came from, using the same on-device retrieval Ask uses, then scrolls to it and highlights it in the live page. It helps you spot-check a claim without re-reading the whole article. Chromium-only for now, same limit as Ask retrieval above.

Videos (YouTube and Bilibili) get their own path: Apogee pulls the video timestamped transcript and makes a short written gist plus a "Key moments" timeline, sized to the video length, where each entry is a clickable link that jumps the video to that moment. When a video description defines real chapters, the summary follows those chapters instead. Sponsor reads and self-promotion are stripped from YouTube transcripts first (see the SponsorBlock lookup in PRIVACY.md).

Social threads get dedicated extractors so long discussions are not flattened by Readability. Reddit, Hacker News, Lobsters, Bluesky, Mastodon, Lemmy, Discourse, Stack Overflow, and GitHub each parse titles, authors, scores, and reply trees into Markdown. Bluesky (`bsky.app`) starts with the public AT Protocol endpoint `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread` (no auth, fully nested thread) and falls back to DOM parsing when offline, capped at 80 posts and depth 8.

Wikipedia gets a dedicated extractor, because its articles are long in a specific way. On the World War II article the generic path pulled 169,014 characters, of which 76,568 (45%) were See also, Notes, References, Further reading and External links, so nearly half the model passes went to citation lists. The extractor cuts all text from the first appendix heading, drops navboxes, infoboxes and the 506 inline citation markers, and re-emits the real section headings so long articles are split on their own limits instead of at blind character offsets. Same article, 85,659 characters in 17 chunks instead of 30. No network call: the page is already open in your tab.

Custom instructions (Settings) let you add your own standing guidance, for example "Explain like I'm five", "Focus on the technical details", or "Answer in a formal tone", applied on top of Apogee built-in prompt for each summary and answer. They sit under the grounding rules (a page cannot use them to make the model invent things), and are capped at 2000 characters. Leave the box blank to use the defaults unchanged.

## System Components and Trust Boundaries

The diagram below shows how parts interact on your local device and marks the only outside links Apogee ever makes.

```mermaid
flowchart TD
    subgraph device["Your Device"]
        subgraph page["Active Tab"]
            EX["Extractors injected on demand<br/>Readability, YouTube, Bilibili, Wikipedia,<br/>Gmail, Reddit, HN, GitHub, Lobsters, arXiv,<br/>Mastodon, Stack Overflow, Lemmy, Discourse, Bluesky"]
            HL["Highlight overlay<br/>scrolls to source text"]
        end

        subgraph ui["Popup / Chromium Side Panel"]
            POPUP["app.js<br/>Summarize, Ask, Uploads, Settings"]
        end

        subgraph bg["Service Worker"]
            ROUTER["Message router<br/>buffered streams, cancel, finalize"]
        end

        subgraph host["Inference Host"]
            WEBLLM["WebLLM WebGPU engine<br/>Chromium default"]
            TJS["Transformers.js WASM engine<br/>Firefox default"]
            EMB["all-MiniLM-L6-v2 embeddings<br/>Ask retrieval and grounding"]
        end

        STORE[("chrome.storage.local<br/>cached summaries, view state, settings")]
        OLLAMA["Ollama on 127.0.0.1:11434<br/>optional local server"]
        LLAMACPP["llama-server on 127.0.0.1:8080<br/>optional local server"]
    end

    HF["Hugging Face<br/>model weights on first run"]
    APIS["SponsorBlock, Bilibili API, Bluesky API<br/>optional segment, subtitle, and thread lookups"]

    POPUP <==>|"inject extractors and read page"| EX
    POPUP -->|"highlight source passage"| HL
    POPUP <==>|"send jobs and receive tokens"| ROUTER
    ROUTER <==>|"send prompts and receive streams"| host
    ROUTER <==>|"HTTP stream"| OLLAMA
    ROUTER <==>|"SSE stream"| LLAMACPP
    POPUP <-->|"read cache"| STORE
    ROUTER <-->|"save results"| STORE

    host -.->|"download once and cache locally"| HF
    ROUTER -.->|"video pages only"| APIS

    classDef local fill:#e6f4ea,stroke:#1e7e34,color:#12351f
    classDef remote fill:#fff4e0,stroke:#c2680a,color:#4a2905
    class EX,HL,POPUP,ROUTER,STORE,WEBLLM,TJS,EMB,OLLAMA,LLAMACPP local
    class HF,APIS remote
    style device fill:#f7fdf9,stroke:#1e7e34,stroke-width:2px,stroke-dasharray:6 4,color:#12351f
```

## Summarization Sequence

When you ask for a summary, content moves through extraction, chunking, hierarchical map-reduce summarization, and token streaming. Short inputs run a single prompt. Long inputs past the model `getMaxChunks` budget (4 for Transformers.js, 12 for Ollama) are mapped per chunk and then tree-folded in groups of `fanIn` until fewer than `maxChunks` intermediates remain, then a final reduce streams the result. Each chunk is covered. Overflow no longer drops text through stratified sampling, and OOM mid-reduce falls back to the joined partials so you still get coverage.

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant P as Popup UI
    participant Page as Active Tab
    participant SW as Service Worker
    participant Engine as AI Engine
    participant DB as Extension Storage

    Note over P,DB: Popup checks local cache first using page URL hash
    You->>P: Click Summarize
    alt Browser page
        P->>Page: Inject extractors and read clean content
        Page-->>P: Return clean text or timestamped transcript
    else Local file or pasted text
        P->>P: Read and parse local input
    end
    P->>DB: Cache extracted content for fast reopening
    P->>SW: Start summarization job
    SW->>Engine: Clean text, chunk content, and run hierarchical map-reduce
    loop Streaming Response
        Engine-->>SW: Stream generated token
        SW-->>P: Forward buffered token stream
        P-->>You: Display summary token by token
    end
    Engine-->>SW: Finalize generation
    SW->>DB: Persist summary and generate suggested follow-up questions
```

## Retrieval and Question Answering Flow

The Ask feature lets you query long documents, PDFs, and video transcripts without losing context through heavy truncation.

1. **Chunking**: The pulled text is split into overlapping semantic passages.
2. **On-Device Embedding**: Each passage is embedded with the `all-MiniLM-L6-v2` model inside the local inference host.
3. **Similarity Search**: Cosine similarity matches your question against all passage vectors to find the most relevant parts.
4. **Grounded Prompting**: Only the most relevant passages go to the language model, keeping answers correct and tied to the source text.

## Sentence Grounding and Highlighting Flow

When you click a summary bullet in Chromium browsers, Apogee highlights the exact sentence in the live page.

1. **Vector Lookup**: The picked bullet text is embedded and compared against the indexed passages of the original article.
2. **Passage Matching**: The closest passage and sentence offsets are found.
3. **DOM Scroll and Highlight**: The extension scrolls the page to the match and highlights the source passage with an interactive overlay.

## Browser Environment Differences

- **Chromium Browsers**: Use Manifest V3 offscreen documents (`chrome.offscreen`) to host WebLLM with full WebGPU hardware acceleration.
- **Firefox**: Firefox extension APIs do not support offscreen documents now. Transformers.js runs straight in the Firefox background page with WebAssembly.
- **Local llama.cpp**: Talks over local loopback (`http://127.0.0.1:8080`) from the background service worker, using the `llama-server` OpenAI-compatible `/v1/chat/completions` endpoint with SSE framing. Works on each build, since it needs neither WebGPU nor an offscreen document.
- **Local Ollama**: Talks straight over local loopback (`http://127.0.0.1:11434`) with HTTP streaming from the background service worker.
- **Automation & Testing**: For E2E browser automation setup with Playwright or Puppeteer and Apogee loaded, see [DEVELOPMENT.md#browser-automation--e2e-testing](DEVELOPMENT.md#browser-automation--e2e-testing).

## Security Architecture and Isolation Boundaries

- **Zero-Trust Message Validation**: All internal WebExtension message routing in `service-worker.js` checks sender context (`sender.id === chrome.runtime.id`) and enforces per-action rules to stop malicious web pages or untrusted scripts from calling extension actions.
- **Loopback Origin Handling**: The `Origin` header is stripped from the extension own `localhost`/`127.0.0.1` requests (Ollama and llama.cpp) so local servers accept them with no extra setup. Where session-scoped rules are supported this is set at runtime for non-tab requests only, so site pages keep their `Origin` headers. The bundled static `rules/ollama-cors.json` stays as a fallback.
- **SponsorBlock Gating**: The SponsorBlock segment lookup runs only when `useSponsorBlock` is on and the optional host permission is granted. With "Stay fully local" on, no lookup request is made and a local phrase heuristic strips sponsor reads instead.
- **Global Scope Isolation**: Content scripts run cleanly inside isolated JavaScript worlds without leaking refs onto DOM global scope objects (`window.__apogeeHighlight` and `window.extractPageContent` removed).
- **Extractor Input Sanitization & Payload Validation**: Site-specific extractors (for example, Gmail) clean header text and control characters to block prompt injection. YouTube and Bilibili extractors cross-check target URL params (`videoId`, `bvid`, `aid`) against embedded script tag structures (`ytInitialPlayerResponse`, `__INITIAL_STATE__`).
- **PDF Payload Bounds**: Binary PDF payloads handled as base64 in `extract-pdf` are checked for correct string typing and capped at 50 MB to stop memory exhaustion attacks.
- **Local File Parsing**: PDF and DOCX files picked or dropped into the popup are parsed inside extension code. DOCX ZIP entries are checked for valid structure, encrypted archives are rejected, and no document bytes go to a remote service.
- **Memory Limits & Out-Of-Memory (OOM) Resilience**: In-browser models catch WebGPU buffer allocation failures and WASM memory limits on their own, calling `resetEngineState` and falling back to bounded `chunkTextOverview` sampling so runs stay stable under tight memory. Long-input map-reduce is also OOM-aware: an `oom_fallback` progress event fires and the tree-reduce stops cleanly, keeping already-made partials and falling back to joined intermediates so the final reduce still streams coverage of each chunk.
