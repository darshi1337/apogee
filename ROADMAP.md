# Apogee Product Roadmap

Apogee is a private, in-browser AI summarizer for articles, videos (YouTube and Bilibili), PDFs, DOCX files, and pasted text. It runs on-device through WebGPU (WebLLM), WebAssembly (Transformers.js), or Local Ollama (127.0.0.1) and llama.cpp.

This document outlines current work, upcoming priorities, and long-term goals for Apogee.

## Now

- **Security & Resilience Hardening**:
  - Out-of-memory (OOM) recovery, stream cancellation buffer release, and overview chunking strategy. (#114)
  - Hierarchical map-reduce for long inputs: every chunk is mapped and partials are tree-folded in groups of `fanIn` until within the model budget, preserving full coverage with OOM-safe fallbacks instead of silently dropping chunks via sampling. (#148)
  - Zero-trust message context validation (`sender.id`), global scope isolation, prompt injection neutralization, and payload bounds. (#121-#127)
- **Multi-Tab Context (Shipped)**:
  - Batch summarize and synthesize across multiple selected tabs via right-click context menu ("Summarize with Apogee"). (#116)
- **Local Document Input (Shipped)**:
  - Select or drag PDF, DOCX, TXT, Markdown, JSON, or HTML files into the popup, or paste arbitrary text for summarization. (#5, #6, #97)
- **Extractor Expansion**:
  - Add page extractors for more platforms (GitLab, Dev.to).
  - Shipped extractors: YouTube, Bilibili, Wikipedia, Gmail, Reddit, Hacker News, GitHub, Lobsters, arXiv, Mastodon, Stack Overflow, Lemmy, Discourse, Bluesky.
  - Keep extractor creation simple so contributors can write unit-tested extractors in Node without running a browser.
- **Test Coverage**:
  - Expand test suites for existing extractors and core modules (455 tests passing).
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
  - Expand export integrations for past summaries to note tools like Obsidian and Notion.
- **Ollama and Custom Host Settings**:
  - Allow custom host settings for self-hosted LLM endpoints with proper CORS handling.

## Later

- **Safari Support**:
  - Explore packaging requirements for Safari support.
- **Custom Extractor Plugin API**:
  - Allow users to load custom extractors directly in settings without editing core source code.

## Non-Goals

- **Cloud Backends**: Apogee will not send, store, or process page text on remote servers.
- **Tracking**: No user tracking, analytics SDKs, or external monitoring.
- **API Keys**: In-browser execution remains free and keyless by default.

## How to Contribute

To help with a roadmap item, check the open issues on GitHub or read CONTRIBUTING.md.
