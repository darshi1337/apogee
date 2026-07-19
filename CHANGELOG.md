# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **In-browser AI on Firefox via Transformers.js.** Firefox has no
  `browser.offscreen` API, so WebLLM (WebGPU) can never run there; Firefox
  now gets its own in-browser provider instead, running ONNX models
  on-device via WebAssembly (no offscreen document or dedicated Worker
  required). Ships with three models (SmolLM2 360M, default; Qwen 2.5 0.5B;
  Llama 3.2 1B), selectable from the same settings UI as WebLLM. Works well
  on modern/fast CPUs; on older or low-power hardware, Local Ollama remains
  the faster option.
- **Retrieval-augmented "Ask" answers.** Instead of truncating long pages to
  the first ~8000 characters, Apogee now embeds the page locally (a small
  on-device model) and answers using only the passages most relevant to the
  question, so questions about content buried deep in long articles, PDFs,
  or video transcripts are answered correctly. Falls back to the previous
  truncation behavior if embedding is unavailable (and always on Firefox,
  which has no offscreen document to run it in).
- **Live Ollama model list.** Local Ollama settings now show whatever models
  you've actually pulled (via Ollama's own `/api/tags`), not just the 4
  hardcoded ones. Falls back to that hardcoded list when Ollama isn't
  reachable yet, and never silently drops your currently-selected model even
  if it's missing from a live response.
- **Per-model chunk sizing for summarization.** Chunk size for Local Ollama
  models now scales with that model's context window (matched by family,
  e.g. `llama3.1`, `qwen2.5`, `gemma3`) instead of one fixed size for every
  model, so capable models need fewer passes over long content. WebLLM's
  in-browser models are unaffected, they share the same small context window
  regardless of which one is picked.

### Fixed

- SponsorBlock sponsor-segment lookups now work on the Firefox build: the
  background page's fetches are bound by the extension CSP there (unlike
  Chrome's service worker), and `sponsor.ajay.app` was missing from the
  Firefox `connect-src`, so every lookup silently fell back to the local
  phrase heuristic.
- The Transformers.js engine now disposes a failed engine before reloading,
  instead of leaking its WASM memory (hundreds of MB of model weights) for
  the life of the background page.
- A failed suggested-questions job (e.g. a storage write hitting quota) no
  longer permanently blocks prompt regeneration for that page.
- Cached view state and extracted page content no longer store the raw page
  URL on disk; only a hash is kept. Cache keys were already hashed
  (URLs can carry session tokens in their query strings), but a plaintext
  copy lingered inside the stored values, undermining that.
- A stale or unknown provider setting (e.g. carried over from the other
  browser's build) now falls back to this build's in-browser provider
  instead of routing to one that can't run here.
- The README's privacy section now discloses the SponsorBlock lookup and
  covers the Firefox WASM inference path; the in-browser "Connected" status
  for Transformers.js now reflects actual WASM availability.

### Security

- The Ollama status/model-list probe now enforces the same loopback-only
  host validation as every other Ollama request. Previously a non-loopback
  URL saved in the host setting would be fetched (`/api/tags`) on every
  popup open, the one gap in the extension's own SSRF rule.

## [0.1.6] - 2026-07-17

### Changed

- **Local Ollama mode now connects directly to Ollama's HTTP API from the
  extension.** There's no separate backend process to install or run anymore,
  the extension talks to `http://127.0.0.1:11434` itself (see the README's
  "Advanced: Local Ollama Mode" section for the one-time `OLLAMA_ORIGINS`
  setup this requires).
- PDF summarization now extracts text fully client-side via `pdf.js`, and
  works in both WebLLM and Local Ollama modes (previously Local Ollama only,
  via the backend).

### Removed

- The `apogee-backend` Node.js server package, superseded by the direct
  Ollama connection above.

### Added

- ESLint + Prettier tooling (`npm run lint` / `npm run format`) and a GitHub
  Actions CI workflow running format checks, lint, tests, and the build on
  every push/PR.
- `CONTRIBUTING.md` and this changelog.

## [0.1.5] - 2026-07-16

- Backend Node port, security/reliability hardening, docs.

## [0.1.4] - 2026-07-15

- Privacy controls, YouTube transcript, and UI fixes.
- Suggested questions moved to a background job with improved state
  management.
- Popup view now persists across reopens; summarize/ask jobs decoupled from
  the popup's lifetime.
- Closed an SSRF redirect bypass, tightened CORS/local-file exposure, and
  hardened PDF error handling.

## [0.1.3] - 2026-07-13

- Cleaned up unused code and dependencies.
- Fixed a duplicate `MAX_CHUNK_CHARS` declaration in `chunk.js`.
- Merged WebLLM bug fixes and performance improvements: UUID stream IDs,
  escaped HTML output, a FIFO-bounded summary cache, chunked/truncated
  prompts, and an offscreen-document idle keep-alive.
- Added Dia browser install instructions.

## [0.1.2] - 2026-07-10

- Fixed an AMO (addons.mozilla.org) submission issue and a caching bug.

## [0.1.1] - 2026-07-09

- Added WebLLM/WebGPU in-browser inference support.
- Added an AWS deployment option for the backend.
- Scoped extension permissions to the active tab and locked network egress
  to loopback.
- Hardened PDF path checks, an XSS issue in the loading indicator, and the
  markdown regex; improved streaming UX and error display.
- Fixed macOS/Chrome compatibility issues.

## [0.1.0] - 2026-06-24

- Initial release.
