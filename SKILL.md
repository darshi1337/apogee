---
name: apogee
description: Navigate and change Apogee private page extraction and local summarization. Use for page, selection, video, PDF, DOCX, or pasted-text extraction, for summarization, or for tests of these pipelines.
license: MIT
compatibility: Requires Node.js 24 or newer. Browser smoke tests require a Chromium or Firefox extension build.
---

# Apogee extraction and summarization

Work from `apogee-extension/`. Keep page content, prompts, summaries, and files on-device. Do not add cloud inference or telemetry.

## Choose the entry point

- Browser pages: start at `lib/extract/pageExtraction.js`. It injects content scripts and asks `content/content.js` for `extract-page-content`. Put site-specific behavior in `content/extractors/`. Register a new extractor in both files.
- Selected text: use `lib/extract/selection.js`. Preserve minimum-selection and user-facing error behavior.
- PDF and DOCX files: use `lib/extract/pdfExtract.js` and `lib/extract/docxExtract.js`. Keep size, expanded-text, archive, and eval-safety limits fail-closed.
- Summarization: the UI starts in `ui/app.js` at `summarizeActivePage()` or `summarizeCustomContent()`. Both run through the shared runner in `ui/jobs.js`. Provider adapters and the engine fallback chain live in `lib/engines/providers.js`. Local generation lives in `lib/summarize/ollamaSummarize.js`. Long-input map-reduce lives in `lib/summarize/mapReduce.js`.
- Background or offscreen routing: keep the message contract aligned between `background/service-worker.js` and `offscreen/offscreen.js`. Stream lifecycle lives in `background/streams.js`, finalize in `background/finalize.js`, suggest-questions in `background/suggestQuestions.js`, and loopback providers in `background/loopbackProviders.js`. Never let a tab-originated message invoke privileged actions.

## Make the change

1. Trace the chosen entry point through extraction, provider routing, and storage before editing.
2. Reuse an existing extractor or provider pattern. Return `null` from a site extractor when the page is outside its scope so generic extraction continues.
3. Preserve cancellation, bounded inputs, user-safe errors, and the privacy rules in `PRIVACY.md`.
4. Add the narrowest Node test. Give extractors a trimmed, anonymized fixture under `tests/extractors/fixtures/`. Put pure-helper tests in the matching directory under `tests/`.

## Validate

Run from the repo root:

```text
npx prettier --check SKILL.md
```

Run from `apogee-extension/`:

```text
npm run format:check
npm run lint
npm test
npm run build
```

If behavior depends on extension APIs, also load `dist/chrome` or `dist/firefox` and exercise the exact summarize or extract path in a browser. Report that separately from the automated checks.
