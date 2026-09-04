<div align="center">

<img alt="Apogee Logo" src=".github/assets/apogee-logo.png" width="112">

# Apogee

A private AI summarizer in your browser for articles, videos, PDFs, DOCX files, and pasted text. It runs on WebGPU, WebAssembly, or your own local Ollama or llama.cpp server.

<a href="https://chromewebstore.google.com/detail/apogee/pgemlpomhkdcjjjcpnjlebalnfglomog"><img alt="Available in Chrome Web Store" src=".github/assets/chrome-web-store.png" width="206" height="58"></a> &nbsp; <a href="https://addons.mozilla.org/en-US/firefox/addon/apogeeext/"><img alt="Get Add-on for Firefox" src=".github/assets/firefox-add-on.svg" width="152" height="53"></a>

<a href="https://darshi1337.github.io/apogee/">Website</a> | <a href="ARCHITECTURE.md">Architecture</a> | <a href="MODELS.md">Models</a> | <a href="BROWSERS.md">Browsers</a> | <a href="PRIVACY.md">Privacy</a> | <a href="ROADMAP.md">Roadmap</a> | <a href="STORE-LISTING.md">Store listing</a> | <a href="LICENSE">License</a>

<sub>An offline-first browser extension that respects privacy, built with care by <a href="https://github.com/darshi1337">darshi1337</a> and <a href="https://github.com/darshi1337/apogee/graphs/contributors">contributors</a></sub>

</div>

> **For AI Assistants and LLMs**: Read [llms.txt](llms.txt) for codebase structure, build scripts, test commands, and developer instructions.

Apogee is an AI browser assistant for articles, videos, emails, and more. It runs fully in your browser: on your GPU with WebGPU (Chrome, Edge, and other Chromium browsers) or on your CPU with WebAssembly, which now works everywhere. WebAssembly is the default on Firefox and an opt-in fallback on Chromium browsers. It helps on machines without WebGPU. No backend, no API keys, no cloud. Install the extension and start.

For power users, Apogee also talks straight to a local Ollama instance over `127.0.0.1` or to a `llama-server` you run yourself.

> **In short:** Apogee summarizes pages, videos, PDFs, DOCX files, and pasted text locally. No account, API key, backend, or cloud upload is needed.

⭐ If Apogee helps you, [star the repository](https://github.com/darshi1337/apogee). It helps the project reach more contributors.

## Get Started

1. Install Apogee from the [Chrome Web Store](https://chromewebstore.google.com/detail/apogee/pgemlpomhkdcjjjcpnjlebalnfglomog) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/apogeeext/).
2. Open a page, video, PDF, or DOCX file, or paste text into the Apogee popup.
3. Pick a summary format and select **Summarize**.

The first in-browser run downloads the picked model. After the model is cached, summaries run offline. For larger models, set up [Ollama](OLLAMA.md) or [llama.cpp](LLAMACPP.md) in Settings.

## Why Apogee

Apogee was inspired by Mozilla's discontinued Orbit project (read the [Review of Orbit by Mozilla](https://discourse.mozilla.org/t/review-of-orbit-by-mozilla/130283)). Orbit tried browser-based page summarization, but it used central API servers and stored summaries on servers.

Apogee fixes Orbit's design and privacy problems by staying local-first:

- **Local by default**: Tokenization, inference, retrieval, and caching happen on your device.
- **Private by design**: Page content, transcripts, files, and summaries never go to cloud APIs.
- **No account needed**: No subscription, API key, telemetry service, or Apogee backend exists.

## At A Glance

The table below compares Apogee with common cloud-based AI extensions and Mozilla's discontinued Orbit project.

| Feature or Architecture | Apogee | Cloud AI Extensions | Mozilla Orbit Project |
| :-- | :-- | :-- | :-- |
| Local On-Device Inference | Yes (WebGPU, WASM, Ollama, and llama.cpp) | No (Requires cloud API endpoints) | No (Relied on remote Mistral 7B servers) |
| Zero API Key Requirement | Yes (No keys, subscriptions, or accounts) | No (Requires API keys or paid tiers) | Yes |
| Offline Functionality | Yes (Works offline after initial weight cache) | No (Requires active internet connection) | No (Failed without server connection) |
| Zero Data Transmission | Yes (Page contents never leave your device) | No (Full webpage text uploaded to servers) | No (Page summaries cached on remote server) |
| Open Source License | Yes (MIT License) | Varies | Yes |
| Local Ollama Integration | Yes (Direct loopback HTTP connection) | Rare | No |
| Local llama.cpp Integration | Yes (Direct loopback HTTP connection to `llama-server`) | Rare | No |
| Grounded Passage Highlighting | Yes (Interactive source sentence scroll) | Rare | No |

## What It Can Do

- **Articles and Web Pages**: Clean text extraction with Readability and site-specific extractors for Wikipedia, GitHub, Reddit, Hacker News, Bluesky, Mastodon, Lemmy, Discourse, Stack Overflow, Lobsters, and arXiv.
- **Selected Text**: Select at least 20 characters on a supported page and use **Selection** in the popup or the browser context menu to summarize only that text. Follow-up Ask questions keep the picked text as their source.
- **YouTube and Bilibili Videos**: Interactive timestamped timelines. Click key moments to jump straight to them in the video.
- **Social Threads**: Bluesky, Reddit, Hacker News, Mastodon, Lemmy, Discourse, and other discussion sites are parsed into structured Markdown. Author, score, and reply order are kept.
- **Local documents and text**: Pick or drag PDF, DOCX, TXT, Markdown, JSON, or HTML files into the popup, or paste text directly.
- **Ask Q&A with Smart Retrieval**: Passages are matched locally. You can ask about long documents without losing context.
- **Grounding and Sentence Highlighting**: Click any summary bullet to scroll the page straight to the source passage on Chromium browsers.
- **Persistent Chrome Side Panel**: Keep the summary or Ask view open next to the page while you browse.
- **Light and dark themes**: Change themes from the home and summary headers.
- **Custom Standing Instructions**: Set your own prompt guidance such as simple explanations or technical summaries.
- **Multi-Language Translation**: Summarize pages into 32 target languages with the default Helsinki-NLP Opus-MT engine or direct LLM translation.

## Screenshots

<table>
<thead>
<tr>
<th align="center" width="50%">Extension Popup</th>
<th align="center" width="50%">Persistent Side Panel</th>
</tr>
</thead>
<tbody>
<tr>
<td align="center" valign="top">
<img alt="Apogee extension popup home view" src=".github/assets/popup-light.png" width="342">
</td>
<td align="center" valign="top">
<img alt="Apogee persistent side panel home view" src=".github/assets/side-panel-light.png" width="520">
</td>
</tr>
</tbody>
</table>

## Privacy

- **Zero Data Leaks**: Page contents, transcripts, PDFs, and summaries are handled locally. They are never uploaded to cloud APIs.
- **Local Loopback**: Ollama and llama.cpp connections run strictly over local loopback (`http://127.0.0.1`). Any other host is refused.
- **Anonymized SponsorBlock**: YouTube sponsor lookups send only a k-anonymity hash prefix. You can turn them off under Settings > Privacy to stay fully local (then no lookup request is made at all).
- **Sensitive Site Exclusions**: Gmail, Outlook, Proton Mail, Yahoo Mail, Google Messages, WhatsApp Web, Telegram Web, Slack, Discord, Microsoft Teams, and custom domain lists are left out of disk caching.

Read the full security model in [Privacy and Security Architecture](PRIVACY.md).

## Documentation Directory

### For Users

- **[Browser Support](BROWSERS.md)**: Browser compatibility table, WebGPU versus WebAssembly execution, and Ollama support.
- **[Model Reference](MODELS.md)**: Full model table, download sizes, context windows, and benchmarks.
- **[Local llama.cpp Guide](LLAMACPP.md)**: Setup steps for linking Apogee to your own `llama-server` instance.
- **[Local Ollama Guide](OLLAMA.md)**: Setup steps for local models on macOS, Windows, and Linux.
- **[Translation Reference](TRANSLATION.md)**: Overview of 29 supported target languages and Opus-MT model tiers.
- **[Privacy Architecture](PRIVACY.md)**: Full details on network limits, storage, and permissions.
- **[Error Messages Guide](ERROR.md)**: Full list of user-facing messages, causes, fixes, and diagnostics.

### For Developers & Contributors

- **[Architecture Reference](ARCHITECTURE.md)**: Details on the 4 contexts, how it works, execution flows, and trust limits.
- **[Developer Setup](DEVELOPMENT.md)**: Steps to build, run watch mode, run test suites, and format code.
- **[Contributing Guide](CONTRIBUTING.md)**: Rules for opening pull requests, sending code changes, and claiming issues.
- **[Project Roadmap](ROADMAP.md)**: Feature roadmap, planned milestones, and completed releases.
- **[Changelog](CHANGELOG.md)**: Full release history and version changes.
- **[Security Policy](SECURITY.md)**: Security policy, how to disclose flaws, and reporting steps.
- **[Code of Conduct](CODE_OF_CONDUCT.md)**: Community standards and guidelines.

## License

[MIT](LICENSE)
