# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Cancel button for Summarize and Ask.** Cancelling now actually interrupts
  generation server-side instead of just hiding the UI while the job kept
  running in the background: `engine.interruptGenerate()` for WebLLM, an
  `AbortController`-driven `fetch` abort for Local Ollama, and a checked
  signal between chunks for Transformers.js. Cancelling a summary returns to
  Home; cancelling a question returns to the empty question box rather than
  discarding the page context.
- **Copy-to-clipboard** buttons on the generated summary, the Ask answer, and
  each entry in the new Past Summaries list below.
- **Past Summaries list on Home**, populated from the same local cache that
  already backed instant reopens. Shows the first line of each summary as a
  one-line preview (markdown markers stripped), click to expand in place.
  Capped at the 8 most recent; hidden entirely with nothing cached yet
  (fresh install) or after clearing data.
- The logo/brand mark in the header is now clickable and returns to Home
  from the Summary view.
- Rotating playful loading text while summarizing (`TL;DRing`, `Distilling`,
  `Orbiting`, `Reaching apogee`, and 30+ more), picked at random each time
  instead of always showing the same "Summarizing" label.
- A one-line credit to Mozilla's discontinued Orbit as this project's
  inspiration, on the "Get in touch" page (see also
  [README.md#inspiration-orbit-killed-by-mozilla](README.md#inspiration-orbit-killed-by-mozilla)).

### Changed

- Replaced the entire icon set. The originals were raster images (17-36 KB
  each) wrapped in an SVG `<pattern>` purely so a CSS filter hack could tint
  them, which is why they looked soft and needed the imprecise filter in the
  first place. Now real vector icons from [Lucide](https://lucide.dev) (ISC)
  and the GitHub mark from [Simple Icons](https://simpleicons.org) (CC0),
  320-820 bytes each. Also fixed five places that were reusing one icon for
  two or three unrelated settings (Status/Privacy, the two in-browser model
  cards, Backend), each now has its own.
- Light theme's icon color only had 2.56:1 contrast against white (measured,
  not eyeballed), under the 3:1 WCAG minimum for graphical UI elements, which
  is why it read as washed-out; retuned to 5.52:1 while leaving dark theme
  (already 8.2:1) untouched.
- The Settings back button now returns to whichever page it was opened from
  (Home or Summary) instead of always landing on Home, which previously
  discarded a just-generated summary still sitting in the DOM.
- "Ask Apogee a question" no longer shows an empty "Suggested Prompts"
  heading before a question has been asked.
- Summary and answer text are now justified instead of ragged-right.
- Every page's header now has rounded top corners. (Rounding all four
  corners was also tried, via `overflow: hidden` on the outer container, but
  that broke the sticky header — confirmed by a real scroll test showing it
  no longer stayed pinned — so it's top corners only for now.)
- Various spacing fixes: redundant stacked bottom padding on the Settings
  and Get in touch pages (56px down to a normal 36px), the gap below
  "Summarize the page" before the loading indicator, the `model-progress`
  card sitting flush against the header (missing top margin), and the
  gaps directly above/below the new Past Summaries list.

### Fixed

- `manifest.json` was missing the `clipboardWrite` permission. Without it,
  `navigator.clipboard.writeText()` from a popup can trigger an interactive
  permission prompt, which, combined with the popup's auto-close-on-blur
  behavior, could silently close the popup mid-copy, i.e. the copy button
  appearing to "disappear" and never actually copying anything.
- The dev-only `popup/mock.js` shim was missing `chrome.storage.onChanged`,
  which `popup.js` calls unconditionally at load, silently breaking the
  entire "open popup.html directly for UI iteration" workflow described in
  its own code comment (no click handlers ever attached).

## [0.1.7] - 2026-07-19

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
