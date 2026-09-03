# Apogee Developer Setup and Contribution Guide

This guide provides a comprehensive overview of Apogee codebase architecture, repository directory layout, testing workflows, and step by step guidelines for contributing to every folder in the project.

## Prerequisites

- **Node.js**: Version 22.0.0 or newer. The repository `.nvmrc` pins Node 22.
- **Package Manager**: npm version 10 or newer.
- **Supported Browsers**: Chrome 116+, Edge 116+, or Firefox 140+ for extension testing.

## Local Environment Setup

1. Clone the repository to your local machine:
   ```bash
   git clone https://github.com/darshi1337/apogee.git
   cd apogee
   ```
2. Install extension dependencies:
   ```bash
   npm run install:extension
   ```

## Development and Build Commands

Run `install:extension`, `build`, `test`, `lint`, `format`, `dev`, and `package` from the repository root or inside the `apogee-extension` directory. The remaining scripts (`format:check`, `build:chrome`, `build:firefox`, `start:firefox`, `start:chrome`, `lint:webext`) exist only inside `apogee-extension/`.

- **Watch Mode (Development)**:

  ```bash
  npm run dev
  ```

  Rebuilds both `dist/chrome` and `dist/firefox` output directories automatically whenever source files change.

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

  Launches an isolated browser instance (Firefox or Chromium) pre-loaded with the local Apogee extension build for live debugging and interactive testing.

- **Windows Build Notes**: Build scripts use POSIX environment variable syntax. If you are using native Windows CMD or PowerShell, run build commands inside **Git Bash** or **WSL** for seamless execution.

## Repository Folder Guide and Contribution Rules

Apogee extension codebase lives in `apogee-extension/`. Below is a breakdown of every folder, what files it contains, and how to contribute to it.

### 1. `content/` (Tab Context Extractor Scripts)

- **What it Contains**: Scripts injected directly into active browser tabs when you trigger summarization or Q&A. Includes `content.js` (main injection script), `Readability.js` (bundled article parser from Mozilla), and specialized site extractors in `content/extractors/` such as `youtube.js`, `bilibili.js`, `wikipedia.js`, `reddit.js`, `gmail.js`, `hackernews.js`, `github.js`, `lobsters.js`, `arxiv.js`, `mastodon.js`, `stackoverflow.js`, `lemmy.js`, `discourse.js`, and `bluesky.js`.
- **How to Contribute**: Create a new extractor file in `content/extractors/` that reads DOM nodes cleanly without mutating global window scope. Register your extractor in `lib/extract/pageExtraction.js`, create a static HTML test fixture in `tests/extractors/fixtures/`, and add unit test cases in `tests/extractors/`.

### 2. `lib/` (Core Application Libraries)

The `lib/` folder contains pure JavaScript logic split into clean functional subdirectories:

#### `lib/engines/` (AI Model Runtime Adapters)

- **What it Contains**: `transformersEngine.js` (WebAssembly CPU engine), `ollamaClient.js` (Local Ollama HTTP streaming client), `llamaCppClient.js` (local llama.cpp SSE client), and `providers.js` (engine registry).
- **How to Contribute**: Add new model configurations to `providers.js` or optimize token streaming handlers inside the provider clients and engine adapters. Keep inference strictly on-device without cloud API dependencies.

#### `lib/extract/` (Text Extraction Routers)

- **What it Contains**: `pageExtraction.js` (tab extraction router), `pdfExtract.js` (client-side PDF parsing using pdf.js), and `docxExtract.js` (dependency-free DOCX ZIP/XML parsing).
- **How to Contribute**: Add routing rules for new extractors or refine fallback text extraction algorithms for complex web layouts.

#### `lib/retrieval/` (On-Device RAG and Semantic Search)

- **What it Contains**: `rag.js` (on-device passage chunking, embedding generation using `all-MiniLM-L6-v2`, and vector similarity retrieval) and `pastSummariesSearch.js` (on-device vector search across saved past summaries).
- **How to Contribute**: Tune cosine similarity thresholds, passage overlap parameters, or optimize vector search index performance.

#### `lib/storage/` (Extension Local Storage Managers)

- **What it Contains**: `pageCache.js` (summary caching, SHA-256 URL key hashing, and sensitive site exclusions) and `settings.js` (user preference persistence and defaults).
- **How to Contribute**: Add user preferences or refine sensitive host exclusion patterns to protect user privacy.

#### `lib/summarize/` (Prompt Engineering and Chunking)

- **What it Contains**: `chunk.js` (dynamic token and character chunker), `prompts.js` (prompt template builders for articles, videos, and Q&A), `mapReduce.js` (hierarchical map-reduce with tree-folding and OOM-safe fallbacks), and `ollamaSummarize.js` (map-reduce pipeline orchestrator and translation directives).
- **How to Contribute**: Improve prompt templates for clarity, refine hierarchical map-reduce chunking and tree-reduction strategy, or enhance target language translation handling.

#### `lib/util/` (Shared Helper Utilities)

- **What it Contains**: `userError.js` (sanitized user-facing error mapping), `permissions.js` (dynamic host permissions checking and on-demand origin prompting), execution mutex locks, and reading time saved calculation functions.
- **How to Contribute**: Add friendly user error mappers or general utility functions used across extension background scripts and popups.

### 3. `background/` (Service Worker Architecture)

- **What it Contains**: `service-worker.js`, which serves as the central background routing hub for Manifest V3. Handles message passing, streaming port connections, offscreen document lifecycles, and alarm cleanup timers.
- **How to Contribute**: Modify service worker message listeners, refine token buffer streaming, or optimize background idle timers.

### 4. `offscreen/` (Chromium Inference Sandbox)

- **What it Contains**: `offscreen.html` and `offscreen.js`, providing an offscreen document context on Chromium browsers to execute WebLLM WebGPU and Transformers.js WebAssembly models outside service worker constraints.
- **How to Contribute**: Update offscreen message handlers, manage WebGPU device initialization, or handle ONNX model weight caching.

### 5. `ui/` (Popup and Side Panel Interface)

- **What it Contains**: `app.html`, `app.css`, `app.js`, and `icons.js` (inline SVG icons), rendering the shared popup and side-panel interface for Home, Summary, Ask, local file upload, Past Summaries search, and Settings views.
- **How to Contribute**: Enhance UI components, update theme styles, improve accessibility, or add interactive controls while adhering to extension design standards.

### 6. `rules/` (Declarative Net Request Security Rules)

- **What it Contains**: `ollama-cors.json`, containing the bundled fallback declarative net request rule that strips origin headers from local loopback requests to `127.0.0.1` and `localhost`. Where session-scoped rules are supported, the service worker registers a narrower equivalent at runtime for non-tab requests only (see `lib/util/loopbackCors.js`).
- **How to Contribute**: Add or adjust declarative net request header rules to maintain zero CORS friction for local loopback services.

### 7. `scripts/` (Build Automation and Verification)

- **What it Contains**: Node scripts such as `model-libs.mjs` for fetching and verifying model WebAssembly binary libraries.
- **How to Contribute**: Add automation scripts for build verification, dependency checking, or asset updates.

### 8. `tests/` (Unit Test Suite and HTML Fixtures)

- **What it Contains**: Zero-dependency unit tests running on Node built-in test runner (`node --test`), organized into subdirectories matching library modules (`tests/background/`, `tests/engines/`, `tests/extract/`, `tests/extractors/`, `tests/helpers/`, `tests/language/`, `tests/retrieval/`, `tests/storage/`, `tests/summarize/`, `tests/ui/`, `tests/util/`), plus `tests/manifest.test.js`, along with static HTML fixtures in `tests/extractors/fixtures/`.
- **How to Contribute**: Add unit test files matching `.test.js` naming conventions, create realistic HTML fixtures for new extractors, and cover edge cases.

## Testing Workflows and Quality Assurance

Before submitting a pull request, run the complete suite of tests and quality checks:

- **Run Unit Tests**:

  ```bash
  npm test
  ```

  Executes the complete unit test suite across extractors, local file parsing, engines, retrieval, storage, prompts, chunking, permissions, and error handlers.

- **Run Linter Checks**:

  ```bash
  npm run lint
  ```

  Runs ESLint across the entire codebase to enforce code quality standards.

- **Check Code Formatting**:
  ```bash
  npm run format:check
  ```
  Verifies that JavaScript and Markdown files follow Prettier formatting rules.

## Browser Automation & E2E Testing

Apogee can be loaded and controlled in automated browser test suites using tools like **Playwright** or **Puppeteer**. Because Chromium extension APIs require headful execution, set `headless: false` when running browser automation.

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

For custom test runners, invoke background service worker actions directly using WebExtension messaging:

```javascript
// Programmatically trigger background page summarization
chrome.runtime.sendMessage({
  type: "BACKGROUND_SUMMARIZE",
  tabId: activeTab.id,
});
```

## Guidelines for Pull Requests

- Keep PRs focused on a single feature, site extractor, or bug fix.
- Ensure all unit tests pass (`npm test`) and no linter warnings are introduced (`npm run lint`).
- Preserve on-device privacy guarantees by keeping all data processing and inference on your local machine.
