# Apogee Product Roadmap

Apogee is a private, in-browser AI summarizer for articles, videos (YouTube and Bilibili), and PDFs. It runs on-device through WebGPU (WebLLM), WebAssembly (Transformers.js), or Local Ollama (127.0.0.1).

This document outlines current work, upcoming priorities, and long-term goals for Apogee.

## Now

- **Extractor Expansion**:
  - Add page extractors for more platforms (Stack Overflow, Mastodon, Lemmy, Discourse, GitLab, Dev.to, Bluesky).
  - Shipped extractors: YouTube, Bilibili, Wikipedia, Gmail, Reddit, Hacker News, GitHub, Lobsters, arXiv.
  - Keep extractor creation simple so contributors can write unit-tested extractors in Node without running a browser.
- **Test Coverage**:
  - Expand test suites for existing extractors (Bilibili) and untested library modules (diagnostics, hash, timestamps, mapReduce, viewState).
- **Firefox Feature Parity**:
  - Bring on-device vector retrieval (Ask) and sentence-level grounding (Highlight-in-page) to Firefox when browser APIs permit.
- **Model and Performance Optimizations**:
  - Keep WebLLM and Transformers.js model libraries updated with small models (SmolLM2, Qwen 2.5, Llama 3.2).
  - Reduce cold-start memory usage and download sizes.

## Next

- **Extractor Generator**:
  - Create a generator tool and template for site extractors with pre-built test fixtures.
  - Support domain-specific prompt rules (such as custom prompts for research papers or tech blogs).
- **UI Improvements**:
  - Add Chrome Side Panel support as an alternative to the popup window.
  - Export past summaries to Markdown, JSON, and note tools like Obsidian and Notion.
- **Ollama and Custom Host Settings**:
  - Allow custom host settings for self-hosted LLM endpoints with proper CORS handling.

## Later

- **Safari Support**:
  - Explore packaging requirements for Safari support.
- **Multi-Tab Context**:
  - Summarize and compare across multiple open tabs or reading lists.
- **Custom Extractor Plugin API**:
  - Allow users to load custom extractors directly in settings without editing core source code.

## Non-Goals

- **Cloud Backends**: Apogee will not send, store, or process page text on remote servers.
- **Tracking**: No user tracking, analytics SDKs, or external monitoring.
- **API Keys**: In-browser execution remains free and keyless by default.

## How to Contribute

To help with a roadmap item, check the open issues on GitHub or read CONTRIBUTING.md.
