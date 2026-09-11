# Apogee Product Roadmap

Apogee is a private AI tool that works in your browser. It makes summaries of articles, videos (YouTube and Bilibili), PDFs, Word documents, and text you copy and paste. It runs on your computer using WebGPU, WebAssembly, or Local Ollama (127.0.0.1) with llama.cpp.

This document shows what we work on now, what we plan soon, and our long-term plans for Apogee.

## Now

- **Making it Stronger and More Reliable**:
  - We fix problems such as out-of-memory (OOM) errors and rough stream stops. (#114)

  - We handle large texts in a special way so the AI does not run out of memory. It breaks the text into smaller parts. It groups the parts. Then the model reads the full text. (#148)

  - We keep messages safe and secure. This means we check who sent each message. We isolate system parts. We stop prompt injection attacks. We limit which data it uses. (#121-#127)

- **Summarize Multiple Tabs**:
  - Select multiple tabs in your browser. Summarize them all at once from the right-click menu ("Summarize with Apogee"). (#116)

- **Use Local Documents**:
  - Load PDFs, Word documents (DOCX), text files (TXT), Markdown files, JSON files, or HTML files directly into Apogee. You can also copy and paste text from anywhere. (#5, #6, #97)

- **Adding More Places to Get Information**:
  - We add extractors for more websites such as GitLab and Dev.to.

  - Extractors already exist for these sites. YouTube, Bilibili, Wikipedia, Gmail, Reddit, Hacker News, GitHub, Lobsters, arXiv, Mastodon, Stack Overflow, Lemmy, Discourse, Bluesky.

  - It is easy to add new extractors. Write simple programs in Node.js. You need no browser.

- **More Testing**:
  - We add more tests for existing extractors and core parts of Apogee. 496 tests pass.

- **Firefox Compatibility**:
  - We make sure Apogee works well on Firefox. When possible, we will bring text questions and sentence highlights to Firefox.

- **Making the AI Faster and Smaller**:
  - We update the WebLLM and Transformers.js libraries with smaller models (SmolLM2, Qwen 2.5, Llama 3.2).

  - We also make startup faster. We reduce download size.

## Next

- **Easy Extractor Tool**:
  - We will create a tool that helps you make extractors for websites. It will hold templates and test programs.

  - You can set special AI rules per website type. Use custom prompts for research papers or tech blogs.

- **Better Export Options**:
  - We will add more ways to save summaries. Save directly to note tools such as Obsidian and Notion.

- **Control Your Own LLM**:
  - You will set up your own settings. Apogee will then use a specific AI endpoint (such as Local Ollama) with proper security measures.

## Later

- **Safari Support**:
  - We will study how to make Apogee work on Safari computers.

- **Custom Extractors**:
  - You will load your own extractors directly in Settings. You need no main-code changes.

## Things We Will Not Do

- **Cloud Servers**: Apogee will never send, store, or process text from websites on remote servers.

- **Tracking Users**: We will not track you or use special tools to collect data about your browsing habits.

- **API Keys**: You need no keys to use Apogee. It works directly in your browser.

## How to Help

To help us build Apogee, check the open issues on GitHub or read CONTRIBUTING.md.
