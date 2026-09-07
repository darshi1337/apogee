# Apogee Developer Setup and Contribution Guide

This guide explains the Apogee codebase layout, repo folder structure, testing steps, and how to contribute to each folder in the project.

## Prerequisites

- **Node.js**: Version 22.0.0 or newer. The repo `.nvmrc` pins Node 22.
- **Package Manager**: npm version 10 or newer.
- **Supported Browsers**: Chrome 116+, Edge 116+, or Firefox 140+ for extension testing.

## Local Environment Setup

1. Clone the repo to your local machine:
   ```bash
   git clone https://github.com/darshi1337/apogee.git
   cd apogee
   ```
2. Install extension dependencies:
   ```bash
   npm run install:extension
   ```

### Dependency overrides

`apogee-extension/package.json` pins three transitive deps above the ranges their parents declare. Each pin exists because of a real advisory, so do not loosen one without checking `npm audit` first:

- `adm-zip@^0.6.0` (`onnxruntime-node` asks for `^0.5.16`): GHSA-xcpc-8h2w-3j85, where a crafted ZIP triggers a multi-gigabyte allocation. Fixed in 0.6.0.
- `sharp@^0.35.0` (`@huggingface/transformers` asks for `^0.34.5`): GHSA-f88m-g3jw-g9cj, libvips flaws up to High severity. Fixed from 0.35.0.
- `brace-expansion@^5.0.9` (old `minimatch@3` asks for `^1.1.7`): GHSA-rgw5-rvv9-x895 and earlier brace-expansion DoS advisories. Forces the patched 5.x line even where old minimatch asks for 1.x.

## Development and Build Commands

Run `install:extension`, `build`, `test`, `lint`, `format`, `dev`, and `package` from the repo root or inside the `apogee-extension` directory. The rest (`format:check`, `build:chrome`, `build:firefox`, `start:firefox`, `start:chrome`, `lint:webext`) live only inside `apogee-extension/`.

- **Watch Mode (Development)**:

  ```bash
  npm run dev
  ```

  Rebuilds both `dist/chrome` and `dist/firefox` output folders on their own whenever source files change.

- **Production Build**:

  ```bash
  npm run build
  ```

  Builds clean production bundles for Chromium (`dist/chrome`) and Firefox (`dist/firefox`).

- **Single Target Builds**:

  ```bash
  npm run build:chrome
  npm run build:firefox
  ```

- **Local Browser Runner (Interactive Testing)**:

  ```bash
  npm run start:firefox
  npm run start:chrome
  ```

  Opens a separate browser instance (Firefox or Chromium) pre-loaded with the local Apogee extension build for live debugging and hands-on testing.

- **Windows Build Notes**: Build scripts use POSIX env var syntax. If you use native Windows CMD or PowerShell, run build commands inside **Git Bash** or **WSL** so the POSIX syntax works.

## Repository Folder Guide and Contribution Rules

The Apogee extension code lives in `apogee-extension/`. Below is what each folder holds, what files it has, and how to contribute to it.

### 1. `content/` (Tab Context Extractor Scripts)

- **What it holds**: Scripts injected straight into active tabs when you start summarization or Q&A. Includes `content.js` (main injection script), `Readability.js` (bundled article parser from Mozilla), and site-specific extractors in `content/extractors/` such as `youtube.js`, `bilibili.js`, `wikipedia.js`, `reddit.js`, `gmail.js`, `hackernews.js`, `github.js`, `lobsters.js`, `arxiv.js`, `mastodon.js`, `stackoverflow.js`, `lemmy.js`, `discourse.js`, and `bluesky.js`.
- **How to contribute**: Add a new extractor file in `content/extractors/` that reads DOM nodes cleanly without touching global window scope. Register your extractor in `lib/extract/pageExtraction.js`, add a static HTML test fixture in `tests/extractors/fixtures/`, and add unit test cases in `tests/extractors/`.

### 2. `lib/` (Core Application Libraries)

The `lib/` folder holds plain JavaScript logic split into clean functional folders:

#### `lib/engines/` (AI Model Runtime Adapters)

- **What it holds**: `transformersEngine.js` (WebAssembly CPU engine), `ollamaClient.js` (Local Ollama HTTP streaming client), `llamaCppClient.js` (local llama.cpp SSE client), and `providers.js` (engine registry).
- **How to contribute**: Add new model configs to `providers.js` or improve token streaming handlers inside the provider clients and engine adapters. Keep inference strictly on-device with no cloud API deps.

#### `lib/extract/` (Text Extraction Routers)

- **What it holds**: `pageExtraction.js` (tab extraction router), `pdfExtract.js` (client-side PDF parsing with pdf.js), and `docxExtract.js` (dep-free DOCX ZIP/XML parsing).
- **How to contribute**: Add routing rules for new extractors or improve fallback text extraction for complex page layouts.

#### `lib/retrieval/` (On-Device RAG and Semantic Search)

- **What it holds**: `rag.js` (on-device passage chunking, embedding with `all-MiniLM-L6-v2`, and vector similarity retrieval) and `pastSummariesSearch.js` (on-device vector search across saved past summaries).
- **How to contribute**: Tune cosine similarity limits, passage overlap values, or improve vector search index speed.

#### `lib/storage/` (Extension Local Storage Managers)

- **What it holds**: `pageCache.js` (summary caching, SHA-256 URL key hashing, and sensitive site exclusions) and `settings.js` (user pref storage and defaults).
- **How to contribute**: Add user prefs or improve sensitive host exclusion patterns to guard user privacy.

#### `lib/summarize/` (Prompt Engineering and Chunking)

- **What it holds**: `chunk.js` (dynamic token and character chunker), `prompts.js` (prompt template builders for articles, videos, and Q&A), `mapReduce.js` (hierarchical map-reduce with tree-folding and OOM-safe fallbacks), and `ollamaSummarize.js` (map-reduce pipeline runner and translation directives).
- **How to contribute**: Improve prompt templates for clarity, improve hierarchical map-reduce chunking and tree-reduction, or improve target language translation handling.

#### `lib/util/` (Shared Helper Utilities)

- **What it holds**: `userError.js` (cleaned user-facing error mapping), `permissions.js` (dynamic host permission checks and on-demand origin prompts), execution mutex locks, and reading time saved calc functions.
- **How to contribute**: Add friendly user error mappers or shared util functions used across extension background scripts and popups.

### 3. `background/` (Service Worker Architecture)

- **What it holds**: `service-worker.js`, which acts as the central background routing hub for Manifest V3. Handles message passing, streaming port links, offscreen document lifecycles, and alarm cleanup timers.
- **How to contribute**: Change service worker message listeners, improve token buffer streaming, or improve background idle timers.

### 4. `offscreen/` (Chromium Inference Sandbox)

- **What it holds**: `offscreen.html` and `offscreen.js`, giving an offscreen document context on Chromium browsers to run WebLLM WebGPU and Transformers.js WebAssembly models outside service worker limits.
- **How to contribute**: Update offscreen message handlers, manage WebGPU device startup, or handle ONNX model weight caching.

### 5. `ui/` (Popup and Side Panel Interface)

- **What it holds**: `app.html`, `app.css`, `app.js`, and `icons.js` (inline SVG icons), rendering the shared popup and side-panel interface for Home, Summary, Ask, local file upload, Past Summaries search, and Settings views.
- **How to contribute**: Improve UI parts, update theme styles, improve accessibility, or add interactive controls while keeping extension design standards.

### 6. `rules/` (Declarative Net Request Security Rules)

- **What it holds**: `ollama-cors.json`, with the bundled fallback declarative net request rule that strips origin headers from local loopback requests to `127.0.0.1` and `localhost`. Where session-scoped rules are supported, the service worker sets a narrower match at runtime for non-tab requests only (see `lib/util/loopbackCors.js`).
- **How to contribute**: Add or adjust declarative net request header rules to keep zero CORS friction for local loopback services.

### 7. `scripts/` (Build Automation and Verification)

- **What it holds**: Node scripts such as `model-libs.mjs` for fetching and checking model WebAssembly binary libs.
- **How to contribute**: Add automation scripts for build checks, dep checks, or asset updates.

### 8. `tests/` (Unit Test Suite and HTML Fixtures)

- **What it holds**: Dep-free unit tests running on Node built-in test runner (`node --test`), grouped into folders matching lib modules (`tests/background/`, `tests/engines/`, `tests/extract/`, `tests/extractors/`, `tests/helpers/`, `tests/language/`, `tests/retrieval/`, `tests/storage/`, `tests/summarize/`, `tests/ui/`, `tests/util/`), plus `tests/manifest.test.js`, plus static HTML fixtures in `tests/extractors/fixtures/`.
- **How to contribute**: Add unit test files matching `.test.js` naming, add realistic HTML fixtures for new extractors, and cover edge cases.

## Testing Workflows and Quality Assurance

Before you open a pull request, run the full tests and quality checks:

- **Run Unit Tests**:

  ```bash
  npm test
  ```

  Runs the full unit test suite across extractors, local file parsing, engines, retrieval, storage, prompts, chunking, permissions, and error handlers.

- **Run Linter Checks**:

  ```bash
  npm run lint
  ```

  Runs ESLint across the full codebase to enforce code quality standards.

- **Check Code Formatting**:
  ```bash
  npm run format:check
  ```
  Checks that JavaScript and Markdown files follow Prettier formatting rules.

## Browser Automation & E2E Testing

Apogee can be loaded and driven in automated browser test suites with tools such as **Playwright** or **Puppeteer**. Because Chromium extension APIs need headful runs, set `headless: false` when running browser automation.

### 1. Playwright (Chromium) Integration Example

Launch Playwright with the unpacked `dist/chrome` build preloaded:

```javascript
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const extensionPath = path.resolve("./apogee-extension/dist/chrome");

  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  await page.goto("https://en.wikipedia.org/wiki/Artificial_intelligence");

  // Trigger background summarize via keyboard shortcut (Alt+Shift+U)
  await page.keyboard.press("Alt+Shift+U");

  // Wait for processing and inspect storage
  await page.waitForTimeout(5000);
  const serviceWorker = context.serviceWorkers()[0];
  const storageData = await serviceWorker.evaluate(() =>
    chrome.storage.local.get(null),
  );
  console.log("Cached Summaries:", storageData);

  await context.close();
})();
```

### 2. Puppeteer (Chromium) Integration Example

```javascript
const puppeteer = require("puppeteer");
const path = require("path");

(async () => {
  const extensionPath = path.resolve("./apogee-extension/dist/chrome");

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await browser.newPage();
  await page.goto("https://en.wikipedia.org/wiki/Artificial_intelligence");

  // Trigger background summarize via shortcut
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyU");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");

  await browser.close();
})();
```

### 3. Programmatic Service Worker Messaging

For custom test runners, call background service worker actions straight with WebExtension messaging:

```javascript
// Programmatically trigger background page summarization
chrome.runtime.sendMessage({
  type: "BACKGROUND_SUMMARIZE",
  tabId: activeTab.id,
});
```

## Guidelines for Pull Requests

- Keep PRs focused on a single feature, site extractor, or bug fix.
- Make sure all unit tests pass (`npm test`) and no new linter warnings appear (`npm run lint`).
- Keep on-device privacy promises by keeping all data handling and inference on your local machine.
