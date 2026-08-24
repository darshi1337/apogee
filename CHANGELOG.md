# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **arXiv abstract extractor.** Custom extractor for arXiv abstract pages (`/abs/*`) that parses paper titles, authors, subjects, arXiv ID, PDF link, and abstract into structured Markdown. (#93)
- **On-device semantic search for past summaries.** Real-time vector search across saved summary titles and content bodies powered by `all-MiniLM-L6-v2` embeddings, automatically stored and capped alongside cached summaries in local storage. (#9)
- **Unit test coverage for cleaner module.** Tests for `lib/summarize/cleaner.js` covering whitespace collapsing, line trimming, double-newline collapsing, and already-clean text. (#79)
- **Unit test coverage for Bilibili extractor.** Extractor tests for `content/extractors/bilibili.js`. (#78)


## [0.2.1] - 2026-08-19

### Added

- **Filter past summaries by title.** A search input above the past summaries list in the popup allows filtering stored summaries in real time by title or content preview. (#25)
- **Lobste.rs site extractor.** Custom extractor for Lobste.rs comment threads that strips navigation/vote metadata, parses comment trees into readable Markdown, and adds thread truncation options. (#22)
- **Detected extractor chip.** Display detected extractor chip (e.g. Lobste.rs, Wikipedia) in the popup header. (#28)
- **Optional YAML frontmatter on Markdown export.** Allow exporting summaries with YAML frontmatter containing metadata like title, URL, and date. (#29)
- **Hindi, Vietnamese, and Thai output languages.** Added output summary translation support for Hindi, Vietnamese, and Thai. (#27)
- **A Wikipedia extractor.** Wikipedia articles were going through the generic Readability path, which kept the whole citation apparatus. On the World War II article that was 169,014 characters in 30 chunks, of which 76,568 (45%) were See also, Notes, References, Further reading and External links. The extractor cuts from the first appendix heading, drops navboxes, infoboxes and the 506 inline citation markers, and re-emits the real section headings as Markdown so the heading-aware chunker can use them: the same article is now 85,659 characters in 17 chunks, and the section detector recognises 33 sections where it previously found 3. Article namespace only; anything else falls through to Readability. No network call.
- **Copy diagnostics as Markdown.** With engine logs recording, Settings now offers a button that copies your settings and the captured logs as a Markdown report ready to paste into an issue, so a bug report says which configuration produced it. Custom instructions and non-loopback Ollama hosts are reported as a shape (`set (42 chars)`, `custom host, port 11434`) rather than their contents. Previously the log panel was only reachable from the model progress bar, so it disappeared once a model was cached.

### Fixed

- **Remember last selected model per provider.** Switching between AI providers (In-Browser GPU, In-Browser CPU, Local Ollama) in Settings preserves and restores the previously selected model for each provider instead of resetting. (#26)
- **Raw engine and browser error strings no longer reach users verbatim.** Errors thrown by pdf.js, WebLLM, Transformers.js, Ollama, or the browser itself were rendered as-is in the popup and in desktop notifications. A new `UserFacingError` class marks messages written for users; everything else is mapped by `toUserMessage()` onto one of six generic fallbacks (PDF, in-browser model, Ollama, stream/disconnect, page-reading, and a catch-all), while the original error is preserved in `console.error` and the diagnostics buffer for bug reports. (#18)

### Changed

- **The popup follows the site's visual language.** Gradients and decorative shadows are gone (the landing page uses neither), the active segmented control is the purple accent rather than ink, the summary card separates by tint instead of shadow, and secondary labels are set in the mono eyebrow style the site uses.
- **Typography corrections in the popup.** The `@font-face` blocks declared a `100 800` weight range for variable fonts whose axis is `200 700`, so the browser was synthesising weights instead of using the real masters. Font families now come from tokens with proper fallback stacks (47 declarations had no fallback at all), and the size scale is eight integer steps instead of thirteen including six half-pixel values.
- **Removed dotted heading patterns.** Removed dotted pattern under headings except the last.

### Removed

- **Four unused bundled fonts.** `Metropolis-{Regular,Medium,Bold}.otf` and `MozillaText-Bold.ttf` were referenced by nothing but were copied into every build, adding roughly 137 KB to the packaged extension.

### Security

- **Prompt fencing and injection protection.** Content fencing and explicit grounding rules added across all prompt builders in `prompts.js` to mitigate prompt injection risks. (#10)
- **Bumped `pdfjs-dist` from 6.1.200 to 6.2.108**, clearing GHSA-hq66-cqwq-w95j (arbitrary JavaScript execution upon opening a malicious PDF). The two existing mitigations (`isEvalSupported: false` and the extension CSP's lack of `unsafe-eval`) already blocked the exploit path, but a known-vulnerable dependency is flagged by `npm audit` and by store reviewers. `npm audit --omit=dev` now reports zero vulnerabilities. (#15)

## [0.2.0] - 2026-08-06

### Fixed

- **The documented permissions now match the manifest.** The privacy policy claimed no host access beyond loopback while the extension also holds `*.bilibili.com` / `*.hdslb.com` for subtitle fetches; the README and the store listing justified a `clipboardWrite` permission that is not requested (the copy buttons use the async Clipboard API, which needs none) and omitted `declarativeNetRequestWithHostAccess`, which is. All four documents now describe the same permission set.
- **Get in touch** is down to the three actions plus a footer: the About Apogee blurb is gone (the same copy already lives in the README and the store listing), and the version line it sat above stays.
- **PDF summarization/Q&A now works on Chrome/Edge.** The PDF's bytes were passed between extension contexts as a raw `ArrayBuffer`, which Chromium's JSON-based message serialization silently turns into an empty object, so every PDF failed as "might be a scanned image" on Chrome/Edge (Firefox structured-clones messages and was unaffected). The bytes now travel base64-encoded. Real PDF failures (password-protected, invalid file) also surface their specific error message now instead of being flattened into the generic scanned-image text.
- **Background summarize (right-click/shortcut) on non-saved pages is no longer lost.** With "Don't save" enabled, or on a sensitive host (Gmail etc.), the per-tab resume pointer was refused entirely, so the completion notification's "click to view" led to an empty Home view. The pointer (stream id + URL hash, no page content) is now stored so the popup can reattach; summaries/Q&A content itself is still never written to disk for those pages.
- Concurrent writes to the summary/content/view-state FIFO indexes are now serialized per context, so two jobs finishing at once can't drop an index entry and leave an orphaned cache key behind.
- The popup no longer falls back to Home with a console error when opened without a granted tab URL (e.g. via a completion notification).
- The "Unknown or expired stream" internal error string was replaced with a user-readable explanation.
- **Summary and answer links now open in the current tab.** Clickable links in a summary or answer (e.g. YouTube jump-to-timestamp links) opened a new tab every time; they now navigate the tab being summarized in place.
- **Clicking a link in an expanded Past Summary no longer collapses the card.** A link inside an expanded entry (again, YouTube timestamps) bubbled up to the card's expand/collapse toggle, so following one also snapped the summary shut.
- **Long unbroken strings no longer get clipped.** A long URL, hash, or code span in a summary or answer ran past the popup edge (clipped by the popup's `overflow-x: hidden`) instead of wrapping; these now break to the next line.
- **An empty answer now explains itself.** A question that streamed back nothing left a blank bordered box, indistinguishable from a glitch; it now shows a short "No answer came back, try rephrasing" message.
- Past Summaries linkify their content deterministically instead of depending on whichever tab happens to be active (a stored summary carries no origin of its own, so only always-trusted YouTube timestamp links stay clickable).
- **A jump-link inside a Past Summary no longer hijacks the current tab.** Past summaries are for other pages, not the tab you're on, so their timestamp links now open a new tab instead of navigating whatever page you currently have open (only current-page summary/answer links seek the active tab).
- **Video summary cards show real content in their preview again.** A video summary opens with a "## Summary" (or "## Overview") heading, which the Past Summaries list rendered as the literal word "Summary" for every video; the preview now skips a leading heading and shows the first line of actual content.
- **The "time saved" badge no longer shows a wrong value on a restored summary.** When a tab carried a stale view state from a previously-visited URL, the badge could size itself against the wrong original (e.g. a past video's runtime applied to an article's cached summary); it is now shown only when the saved inputs belong to the page being displayed.
- Settings radio buttons keep their circular shape when a long label wraps, and the summary footer no longer leaves an empty gap when it has nothing to show (e.g. after a summarize error).
- **Long-running jobs are no longer killed mid-generation on Chrome.** Manifest V3 terminates the background service worker after ~30s without an extension event, and a job buffered there (Local Ollama always, Transformers.js on Firefox) can easily stay silent longer than that: a multi-chunk summarize emits nothing while it maps each chunk, and a cold Ollama model can take that long to return its first token. The worker was dying mid-fetch and the popup reported "Connection to the model was lost before the response finished". A 20s heartbeat now holds the worker up for exactly as long as a job (including the suggested-questions pass that follows it) is actually running.
- **Local Ollama summaries of long pages now report progress** instead of sitting on a frozen spinner until the final pass starts streaming. The map/reduce/translate stages report "Summarizing part N of M", "Merging summary", and "Translating", the same treatment the in-browser engines already had.

### Changed

- **No more remotely loaded code: WebLLM's per-model WASM kernels are now bundled into the Chrome package** (downloaded and SHA-256-verified at build time, see `apogee-extension/scripts/model-libs.mjs`) instead of being fetched from `raw.githubusercontent.com` at runtime, and that host was removed from the extension CSP. This closes a supply-chain hole and a Chrome Web Store "no remotely hosted code" policy risk; only model weights (data) are fetched at runtime. `@mlc-ai/web-llm` is now pinned exactly so the bundled kernels can't drift from the engine version.
- **SponsorBlock sponsor stripping now always runs.** The k-anonymity lookup is best-effort: when a video has no crowd data, the request fails, or you have turned the lookup off under Settings, Privacy, the local, network-free phrase heuristic runs instead, so sponsor reads are stripped either way.
- The two in-browser AI provider options are now labeled **In-Browser AI (GPU)** (WebGPU) and **In-Browser AI (CPU)** (Transformers.js), instead of two identical "In-Browser AI" rows told apart only by a small badge.
- A distinct amber "Checking…" status dot shows during the initial connection probe (which can take a few seconds on a cold WebGPU start) instead of the gray "disconnected" dot.
- The header logo no longer shows a clickable cursor on Home, where its "back to Home" click is a no-op; it still works as that shortcut from Summary and the other views.
- **Redesigned popup: an original duotone icon set and a flat, ruled layout.** The 26 shipped SVG assets are replaced by icons drawn for Apogee and inlined in `popup/icons.js`: every glyph is a soft accent fill under a `currentColor` stroke, so an icon takes the colour of the text beside it instead of being recoloured through a CSS filter. `icons.js` loads as its own module script, so glyphs still render if `popup.js` fails to boot, and icon buttons carry an `aria-label` now that there is no `<img alt>`. The surrounding chrome matches: rounded cards and drop shadows give way to boxes stacked flush on a shared hairline. The same set is shared with the landing page (`docs/app.js`).
- **Response format moved out of Settings** onto the home view, as a segmented bullets/sentences/paragraphs control directly under "Summarize this page", so the choice sits where it is used.
- **Internal code layout:** `lib/` (30 flat modules) and its `tests/` were reorganized into domain subfolders, `engines/`, `summarize/`, `language/`, `extract/`, `retrieval/`, `storage/`, and `util/`, with `constants.js` kept at the root. A pure move plus import-path rewrite; no behavior change.
- **Video summaries are now a length-scaled brief.** A YouTube or Bilibili summary is a short written gist plus a "Key moments" timeline of jump-to-timestamp links, sized to the video's length (a short clip gets a few moments, a long talk gets a denser timeline). When the video's description defines real chapters, the summary follows those chapters instead, with a section per chapter. Every timestamp stays a clickable link back to that moment in the video.
- **The "~X min saved" badge now persists across popup reopen.** The inputs it needs (a video's runtime, or the original page's word count) are saved alongside the summary, so the badge is recomputed and shown again when a cached summary is restored, instead of vanishing the first time the popup was closed and reopened.

### Added

- **A landing page** at <https://darshi1337.github.io/apogee/>, served from `docs/` and published by a GitHub Pages workflow on every push to main that touches it. Static, no build step, and it shares the extension's icon set.
- **Bilibili video support.** Bilibili videos are now summarized the same way YouTube videos are: the extractor pulls the video's timestamped subtitle track (fetched through the service worker, using your existing Bilibili login, since Bilibili only exposes subtitles to a signed-in session) and the summary carries jump-to-moment links back into the video (`?t=<seconds>`). Multi-part videos honor the `?p=N` selector, and a video with no subtitles falls back to a description-only summary. See the privacy policy for the one new network request this adds.
- **Custom instructions.** A free-text box under Settings lets you add standing instructions (e.g. "Explain like I'm five", "Focus on the technical details", "Answer in a formal tone") that are appended to every summary and Ask answer on top of Apogee's built-in prompt. They are layered under the grounding rules, so a page cannot smuggle instructions through this channel, and capped at 2000 characters. Leave it blank to use the defaults unchanged.
- **Translations: summaries, Q&A answers, and suggested questions can now be produced in a chosen output language** (Settings, then Summary language; 29 languages, English by default, "Same as article" to keep the source language). Two engines are selectable under Settings, then Translation engine: the default **LLM** engine (the summarization model writes directly in the target language, verified, with a translate-pass fallback, no extra download), and an opt-in **Opus-MT** engine (dedicated Helsinki-NLP translation models, ~80&nbsp;MB each, downloaded from Hugging Face and cached offline) that generates neutrally then translates deterministically while preserving bullet/timestamp structure. Opus-MT is stronger on low-resource languages; it uses dedicated `opus-mt-en-<code>` models where available, the grouped `opus-mt-en-mul` model otherwise, and falls back to the LLM engine for the handful of languages it can't reach (Slovak, Korean, Traditional Chinese). See the README "Translations" section for the full per-language model table.
- Keyboard accessibility: Settings radio buttons have a visible focus ring again, summary bullets can be focused and activated (Enter/Space) for highlight-in-page, and all decorative motion is disabled under `prefers-reduced-motion`.
- **Screen reader support across the popup.** The connection status pills and the model-download banner are live regions, the progress bar reports its value through `role="progressbar"` (the percentage text is hidden from assistive tech so it can't re-announce on every tick), and a clipped live region speaks the events that have no visible text of their own: summary ready, answer ready, copied. Summary failures announce as alerts. The logs panel, the prompts toggle and each past-summary card now expose `aria-expanded`, and switching views moves focus to the view being opened instead of leaving it stranded on the hidden one.
- The **Get in touch** footer credits contributors, linking to the repository's contributor graph.
- Bundled font licenses are now documented and shipped (`apogee-extension/assets/fonts/LICENSE.md`).

### Security

- **Cache keys are derived with SHA-256 instead of a 53-bit non-cryptographic hash.** Summary, prompt and page-content keys, plus the per-tab view-state pointer, are keyed by a truncated SHA-256 of the page URL. The previous cyrb53 digest was short enough to brute-force against a candidate URL list, so anyone with local access to extension storage could confirm which pages had been summarized; that no longer holds. Keys written by earlier versions simply miss and age out of the FIFO, which costs one re-summarize per cached page. cyrb53 remains where it is not a privacy boundary (the in-memory embedding index).
- Engine progress logging is now opt-in rather than always writing model-loading diagnostics to the console. Errors are still logged unconditionally. It is switchable in two places that stay in sync: **Settings, then Diagnostics**, which can be armed before starting a job (what a bug report needs), and the existing **Show logs** panel, which only exists while the model-progress banner is on screen.

## [0.1.9] - 2026-07-25

### Changed

- **Bullet summaries of long documents are now deduplicated and coherent.** Bullets mode previously streamed each chunk's bullets straight through with no merge step, so a long multi-chunk document (e.g. a big PDF) could repeat the same point across chunk boundaries. It now runs the same map + reduce shape as the other modes: every chunk is summarized, then a single synthesis pass merges them into one deduplicated list. To avoid the old regression where a fixed 8-14-bullet reduce crushed a whole document down to almost nothing, the reduce pass scales its target bullet count with the number of chunks merged (grows per chunk beyond the first, capped so a very long document stays skimmable). WebLLM and Ollama share this logic, so both backends produce identical output for the same page.

### Added

- **Transformers.js (in-browser CPU AI) is now available on Chrome/Edge**, not just Firefox, as an opt-in alternative to WebLLM in Settings, useful on machines without WebGPU.
- **Resummarize button** on the finished summary card, re-runs the summarize flow (re-extracting the live page, not a stale cache) without going back to Home first. Shares the same cancel-in-flight/re-run path as the Home "Summarize this page" button.
- **"~X min saved" badge** on the finished summary card, estimated locally from original vs. summary word count against an average reading speed, no server round-trip. Hidden when the gap is negligible (near-empty page, or a summary that isn't meaningfully shorter) or when the summary came straight from cache on popup reopen, since the original page text isn't held onto in that case. For YouTube videos the badge instead compares the video's actual runtime against the time to read the summary, since a transcript's word count doesn't track spoken-word runtime the way normal reading speed tracks normal reading.
- **Timestamped YouTube summaries.** The transcript extractor now threads inline `[MM:SS]` markers through the text (from SponsorBlock/heuristic- cleaned captions), and the summarizer cites them as clickable links back to that moment in the video (`&t=SECONDSs`), inspired by [tantara/openbrief](https://github.com/tantara/openbrief)'s YouTube summarizer. Every point still follows your chosen response format (bullets, sentences, or paragraphs); each one just leads with its timestamp link now. Long videos are condensed in a map pass (one model call per transcript chunk) before a single assembly pass turns the notes into the final summary, the same chunking budget per-model summaries already use.

### Fixed

- **YouTube timestamp links on Shorts.** Timestamp deep-links assumed a `watch?v=` URL with an existing query string, so a bare `/shorts/<id>` URL produced a broken `/shorts/abc&t=42s`. Links now normalize to a canonical `watch?v=<id>&t=` URL when the video id is recognizable (Shorts, `youtu.be`, or `watch`), and otherwise pick the right `?t=`/`&t=` separator for whatever URL they were given.
- **Cancelling one summary no longer interrupts another.** Cancelling a WebLLM stream called `interruptGenerate()` unconditionally, so cancelling a queued or already-finished job during a rapid resummarize could stop the different job that actually held the engine. The offscreen document now tracks which stream owns the engine and only interrupts when the cancelled stream is the one generating.
- **Malformed Ollama responses report the real cause.** A bad line in Ollama's streaming NDJSON used to surface as "Could not connect to Ollama…", sending users to chase a networking problem that wasn't there; it now reports a malformed-response error instead.
- **Background summarize on an empty page is no longer silent.** A context-menu or keyboard-shortcut summarize that bailed early (unreadable page, no thread open in Gmail, image-only PDF) returned with no feedback; it now posts a "Nothing to summarize" notification explaining why.
- **Transformers.js no longer freezes on long articles.** Input past the model's context budget used to grow chunks without bound instead of capping them, so a long page could stall for tens of minutes with no visible progress, indistinguishable from a hang. Long input is now truncated to a bounded number of context-sized chunks instead (with a "Long page, summarizing the beginning" notice), generation length is capped, and the progress line updates continuously with a running word count instead of sitting on one static message for the whole wait.
- Summary error messages use a theme-aware color instead of a hardcoded red.

### Security

- **Links in model output are restricted to the summarized page's own origin** (plus `youtube.com`, the only host Apogee itself asks the model to link to, for jump-to-video timestamps). Because model output is steered by page content, a malicious page could otherwise get a phishing link, dressed as a timestamp, rendered as a real clickable link in the popup; such links now render as plain text.
- **Per-tab view state is cleared when a tab closes** rather than lingering until FIFO eviction, and **completion notifications omit the page title on sensitive hosts** (email, messaging), where a title can carry a subject line or address that OS notification centers may log persistently.
- **The Transformers.js WASM runtime is now bundled with the extension** instead of being fetched from jsDelivr at runtime, closing the last unverified-remote-code path in the in-browser inference stack. Chrome's CSP no longer needs a CDN allowance at all.

## [0.1.8] - 2026-07-21

### Added

- **Cancel button for Summarize and Ask.** Cancelling now actually interrupts generation server-side instead of just hiding the UI while the job kept running in the background: `engine.interruptGenerate()` for WebLLM, an `AbortController`-driven `fetch` abort for Local Ollama, and a checked signal between chunks for Transformers.js. Cancelling a summary returns to Home; cancelling a question returns to the empty question box rather than discarding the page context.
- **Copy-to-clipboard** buttons on the generated summary, the Ask answer, and each entry in the new Past Summaries list below.
- **Past Summaries list on Home**, populated from the same local cache that already backed instant reopens. Shows the first line of each summary as a one-line preview (markdown markers stripped), click to expand in place. Capped at the 8 most recent; hidden entirely with nothing cached yet (fresh install) or after clearing data.
- The logo/brand mark in the header is now clickable and returns to Home from the Summary view.
- Rotating playful loading text while summarizing (`TL;DRing`, `Distilling`, `Orbiting`, `Reaching apogee`, and 30+ more), picked at random each time instead of always showing the same "Summarizing" label.
- A one-line credit to Mozilla's discontinued Orbit as this project's inspiration, on the "Get in touch" page (see also [README.md#inspiration-orbit-killed-by-mozilla](README.md#inspiration-orbit-killed-by-mozilla)).
- **Page titles in the Past Summaries list.** Entries previously showed only a one-line text preview, URLs are deliberately never stored (even cache keys only carry a hash), so there was no way to tell entries apart at a glance; each card now also shows the page's title above the preview. Entries persisted before this existed just show the preview alone.
- **Right-click "Summarize this page"** context-menu entry and a keyboard shortcut (default `Alt+Shift+U`, remappable any time via `chrome://extensions/shortcuts`) that summarize the active tab without opening the popup at all. A hint badge on the "Summarize this page" button shows whatever the shortcut is actually currently bound to (read live via `chrome.commands.getAll()`, so it can't go stale if you remap or clear it, unlike a hardcoded label). A system notification fires when a shortcut/context-menu-triggered summary finishes (or fails); clicking it focuses the tab and opens the popup. Opening the popup while a background-triggered summary is still generating now shows the normal loading view (spinner, rotating verb) and live-streams the result, the same as a popup-triggered summary, instead of the default Home page with no indication anything is happening.
- **"Copy as Markdown"** button next to the existing plain-text copy button on the summary card, formats a proper note (title, source URL, summary body) for pasting into notes apps, distinct from the plain-text copy.
- **Highlight-in-page.** Click a summary bullet (or sentence/paragraph line, depending on your chosen format) to scroll to and highlight the passage of the original page it's most likely grounded in, so you can visually check the model isn't inventing things. Uses the same on-device embedding retrieval Ask already relies on to find the best-matching original-content chunk, then locates and highlights it in the live page via the CSS Custom Highlight API (no DOM mutation, so it doesn't fight React/Vue-managed pages that revert unexpected changes). Chromium-only for now, the same constraint Ask's own retrieval already has (needs the offscreen document); the affordance simply isn't shown on the Firefox build.

### Changed

- Replaced the entire icon set. The originals were raster images (17-36 KB each) wrapped in an SVG `<pattern>` purely so a CSS filter hack could tint them, which is why they looked soft and needed the imprecise filter in the first place. Now real vector icons from [Lucide](https://lucide.dev) (ISC) and the GitHub mark from [Simple Icons](https://simpleicons.org) (CC0), 320-820 bytes each. Also fixed five places that were reusing one icon for two or three unrelated settings (Status/Privacy, the two in-browser model cards, Backend), each now has its own.
- Light theme's icon color only had 2.56:1 contrast against white (measured, not eyeballed), under the 3:1 WCAG minimum for graphical UI elements, which is why it read as washed-out; retuned to 5.52:1 while leaving dark theme (already 8.2:1) untouched.
- The Settings back button now returns to whichever page it was opened from (Home or Summary) instead of always landing on Home, which previously discarded a just-generated summary still sitting in the DOM.
- "Ask Apogee a question" no longer shows an empty "Suggested Prompts" heading before a question has been asked.
- Every page's header now has rounded top corners. (Rounding all four corners was also tried, via `overflow: hidden` on the outer container, but that broke the sticky header, confirmed by a real scroll test showing it no longer stayed pinned, so it's top corners only for now.)
- Various spacing fixes: redundant stacked bottom padding on the Settings and Get in touch pages (56px down to a normal 36px), the gap below "Summarize the page" before the loading indicator, the `model-progress` card sitting flush against the header (missing top margin), and the gaps directly above/below the new Past Summaries list.
- Settings' "Backend" card is now labeled "Ollama", and its URL field's placeholder shows Ollama's actual default port (`:11434`, was showing `:8000`, left over from the old backend-server era). The field also now auto-prefixes `http://` onto a bare `host:port` value (e.g. `127.0.0.1:11434`), and surfaces the specific reason a host was rejected (wrong scheme, non-loopback host) instead of the same generic "connect to Ollama to see yours" shown when Ollama simply isn't running yet.
- The debug-logs toggle is now a real `<button>` instead of a `<span>` with a click handler, restoring keyboard focus/activation. The debug-logs panel itself moved off hardcoded dark-only inline styles onto the same themed CSS variables as the rest of the popup (it was nearly invisible in light theme).
- `prefers-reduced-motion` now also covers the connected-status pulse and the hover translate/scale transforms throughout the popup, not just the loading spinner and dots.
- The popup's initial view (a resumed stream, a cached summary, Settings, etc.) no longer waits on the WebGPU/Ollama connectivity probe before rendering. That probe can take several seconds on a cold start (creating the offscreen document) and has no bearing on which view should be shown.
- Dependency hygiene: `web-ext` now lives in `apogee-extension/package.json` (where it's actually used) instead of the repo root; `npm audit` is clean (0 vulnerabilities, was 3 high via `adm-zip`/`onnxruntime-node`, both Node-only dev tooling that never ships in the extension itself).
- Summaries are now persisted (and suggested questions generated) by the background job itself as soon as it finishes, not by whichever popup happens to still be open long enough to consume the stream. This is what makes the context-menu/keyboard-shortcut entry points above possible at all (there's no popup to rely on), and as a side effect fixes a pre-existing gap where an ordinary popup-triggered summary could be silently lost if the popup was closed before the 2-minute stream-buffer window expired.
- `manifest.json` gained `contextMenus` and `notifications` permissions and a `commands` entry, needed for the two new entry points above. No new host permissions or outbound network calls came with any of this.

### Removed

- Dead code left over from earlier refactors: the unused provider-level `suggestQuestions()` methods and their corresponding service-worker/ offscreen message handlers (`load-model`, `unload-model`, and three `*-suggest-questions` variants with no remaining caller). The actually-used suggested-questions path, the backgrounded job that persists results to storage, is unaffected.
- The unused `ClashDisplay` font: declared via `@font-face` but never applied anywhere, shipped in every install for nothing.

### Fixed

- `manifest.json` was missing the `clipboardWrite` permission. Without it, `navigator.clipboard.writeText()` from a popup can trigger an interactive permission prompt, which, combined with the popup's auto-close-on-blur behavior, could silently close the popup mid-copy, i.e. the copy button appearing to "disappear" and never actually copying anything.
- The dev-only `popup/mock.js` shim was missing `chrome.storage.onChanged`, which `popup.js` calls unconditionally at load, silently breaking the entire "open popup.html directly for UI iteration" workflow described in its own code comment (no click handlers ever attached).
- Asking a follow-up question about a PDF, after summarizing it, used to silently discard the already-extracted PDF text and re-run extraction from scratch, which returns no text for PDFs (that needs `pdf.js`, run separately via the service worker); asking without summarizing first failed outright with "Could not extract enough page content to answer." Both paths now reuse or re-extract the real PDF text correctly.
- The model-progress banner ("Summarizing part 2 of 3...", "Reconnecting to local model...") no longer lingers indefinitely after the job finishes. It previously only auto-hid on reaching 100% download progress, which text-only status messages never report.
- Copy buttons for the summary and the Ask answer now reappear correctly after reopening the popup on a cached/resumed result, instead of staying hidden (and, for the answer, copying nothing even if manually revealed).
- Starting a new summarize or ask while a previous one was still generating now cancels the previous job, instead of leaving it running in the background for up to two minutes and racing the new one to update the DOM.
- A stale cross-build provider setting (e.g. `"webllm"` left over in a Firefox profile) no longer silently fails to generate suggested questions; it's now normalized the same way the main provider selection already was.
- Summarizing or asking about a browser-internal page (`chrome://`, `about:`, etc.) now shows a clear "Apogee can't read this page" message instead of the raw low-level error `chrome.scripting.executeScript` throws for those.

### Security

- Tightened the Ollama host allowlist to exactly match what's actually reachable/declared: dropped `https:` and the IPv6 `[::1]` literal, which used to pass validation but could never really be fetched (blocked by the manifest's own CSP on Firefox, and not declared in `host_permissions` either way).
- Narrowed the YouTube caption-URL allowlist from `*.google.com` (far wider than captions are ever actually served from) down to `*.youtube.com` / `*.googlevideo.com`.
- Added Telegram, Slack, Discord, and Microsoft Teams to the list of hosts whose content is never persisted to disk regardless of the history setting (previously covered Gmail, Outlook, Proton Mail, Yahoo Mail, Google Messages, and WhatsApp Web).

## [0.1.7] - 2026-07-19

### Added

- **In-browser AI on Firefox via Transformers.js.** Firefox has no `browser.offscreen` API, so WebLLM (WebGPU) can never run there; Firefox now gets its own in-browser provider instead, running ONNX models on-device via WebAssembly (no offscreen document or dedicated Worker required). Ships with three models (SmolLM2 360M, default; Qwen 2.5 0.5B; Llama 3.2 1B), selectable from the same settings UI as WebLLM. Works well on modern/fast CPUs; on older or low-power hardware, Local Ollama remains the faster option.
- **Retrieval-augmented "Ask" answers.** Instead of truncating long pages to the first ~8000 characters, Apogee now embeds the page locally (a small on-device model) and answers using only the passages most relevant to the question, so questions about content buried deep in long articles, PDFs, or video transcripts are answered correctly. Falls back to the previous truncation behavior if embedding is unavailable (and always on Firefox, which has no offscreen document to run it in).
- **Live Ollama model list.** Local Ollama settings now show whatever models you've actually pulled (via Ollama's own `/api/tags`), not just the 4 hardcoded ones. Falls back to that hardcoded list when Ollama isn't reachable yet, and never silently drops your currently-selected model even if it's missing from a live response.
- **Per-model chunk sizing for summarization.** Chunk size for Local Ollama models now scales with that model's context window (matched by family, e.g. `llama3.1`, `qwen2.5`, `gemma3`) instead of one fixed size for every model, so capable models need fewer passes over long content. WebLLM's in-browser models are unaffected, they share the same small context window regardless of which one is picked.

### Fixed

- SponsorBlock sponsor-segment lookups now work on the Firefox build: the background page's fetches are bound by the extension CSP there (unlike Chrome's service worker), and `sponsor.ajay.app` was missing from the Firefox `connect-src`, so every lookup silently fell back to the local phrase heuristic.
- The Transformers.js engine now disposes a failed engine before reloading, instead of leaking its WASM memory (hundreds of MB of model weights) for the life of the background page.
- A failed suggested-questions job (e.g. a storage write hitting quota) no longer permanently blocks prompt regeneration for that page.
- Cached view state and extracted page content no longer store the raw page URL on disk; only a hash is kept. Cache keys were already hashed (URLs can carry session tokens in their query strings), but a plaintext copy lingered inside the stored values, undermining that.
- A stale or unknown provider setting (e.g. carried over from the other browser's build) now falls back to this build's in-browser provider instead of routing to one that can't run here.
- The README's privacy section now discloses the SponsorBlock lookup and covers the Firefox WASM inference path; the in-browser "Connected" status for Transformers.js now reflects actual WASM availability.

### Security

- The Ollama status/model-list probe now enforces the same loopback-only host validation as every other Ollama request. Previously a non-loopback URL saved in the host setting would be fetched (`/api/tags`) on every popup open, the one gap in the extension's own SSRF rule.

## [0.1.6] - 2026-07-17

### Changed

- **Local Ollama mode now connects directly to Ollama's HTTP API from the extension.** There's no separate backend process to install or run anymore, the extension talks to `http://127.0.0.1:11434` itself (see the README's "Advanced: Local Ollama Mode" section for the one-time `OLLAMA_ORIGINS` setup this requires).
- PDF summarization now extracts text fully client-side via `pdf.js`, and works in both WebLLM and Local Ollama modes (previously Local Ollama only, via the backend).

### Removed

- The `apogee-backend` Node.js server package, superseded by the direct Ollama connection above.

### Added

- ESLint + Prettier tooling (`npm run lint` / `npm run format`) and a GitHub Actions CI workflow running format checks, lint, tests, and the build on every push/PR.
- `CONTRIBUTING.md` and this changelog.

## [0.1.5] - 2026-07-16

- Backend Node port, security/reliability hardening, docs.

## [0.1.4] - 2026-07-15

- Privacy controls, YouTube transcript, and UI fixes.
- Suggested questions moved to a background job with improved state management.
- Popup view now persists across reopens; summarize/ask jobs decoupled from the popup's lifetime.
- Closed an SSRF redirect bypass, tightened CORS/local-file exposure, and hardened PDF error handling.

## [0.1.3] - 2026-07-13

- Cleaned up unused code and dependencies.
- Fixed a duplicate `MAX_CHUNK_CHARS` declaration in `chunk.js`.
- Merged WebLLM bug fixes and performance improvements: UUID stream IDs, escaped HTML output, a FIFO-bounded summary cache, chunked/truncated prompts, and an offscreen-document idle keep-alive.
- Added Dia browser install instructions.

## [0.1.2] - 2026-07-10

- Fixed an AMO (addons.mozilla.org) submission issue and a caching bug.

## [0.1.1] - 2026-07-09

- Added WebLLM/WebGPU in-browser inference support.
- Added an AWS deployment option for the backend.
- Scoped extension permissions to the active tab and locked network egress to loopback.
- Hardened PDF path checks, an XSS issue in the loading indicator, and the markdown regex; improved streaming UX and error display.
- Fixed macOS/Chrome compatibility issues.

## [0.1.0] - 2026-06-24

- Initial release.
