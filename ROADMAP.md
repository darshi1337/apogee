# Apogee Product Roadmap

Apogee is a private AI tool that works in your browser. It makes summaries of articles, videos (YouTube and Bilibili), PDFs, Word documents, and text you copy and paste. It runs on your computer using WebGPU, WebAssembly, or Local Ollama (127.0.0.1) with llama.cpp.

This document shows what we are working on now, what we plan to do soon, and our long-term plans for Apogee.

## Now

- **Making it Stronger & More Reliable**:
  - We're fixing problems like running out of memory (OOM) and stopping streams smoothly. (#114)
  - We’re using a special way to handle big pieces of text so the AI doesn’t run out of memory. It breaks the text into smaller parts, groups them together, and then uses the model to understand everything. (#148)
  - We're making sure messages are safe and secure. This includes checking who sent the message, isolating different parts of the system, stopping prompt injection attacks, and limiting what data can be used. (#121-#127)
- **Summarize Multiple Tabs**:
  - You can now select multiple tabs in your browser and have Apogee summarize them all at once using the right-click menu ("Summarize with Apogee"). (#116)
- **Use Local Documents**:
  - You can load PDFs, Word documents (DOCX), text files (TXT), Markdown files, JSON files, or HTML files directly into Apogee. Or you can just copy and paste text from anywhere. (#5, #6, #97)
- **Adding More Places to Get Information**:
  - We’re adding extractors to get information from more websites like GitLab and Dev.to.
  - We already have extractors for: YouTube, Bilibili, Wikipedia, Gmail, Reddit, Hacker News, GitHub, Lobsters, arXiv, Mastodon, Stack Overflow, Lemmy, Discourse, Bluesky.
  - It’s easy to add new extractors – you can write simple programs in Node.js without needing a browser.
- **More Testing**:
  - We're adding more tests for the existing extractors and core parts of Apogee (496 tests are passing).
- **Firefox Compatibility**:
  - We want to make sure Apogee works well on Firefox. When possible, we’ll bring features like asking questions about the text and highlighting specific sentences to Firefox.
- **Making the AI Faster & Smaller**:
  - We keep updating the WebLLM and Transformers.js libraries with smaller versions of the models (SmolLM2, Qwen 2.5, Llama 3.2).
  - We’re also making it faster to start up and reducing how much data needs to be downloaded.

## Next

- **Easy Extractor Tool**:
  - We'll create a tool that helps you easily make extractors for websites. It will have templates and test programs.
  - You can set special rules for the AI based on the type of website (like custom prompts for research papers or tech blogs).
- **Better Export Options**:
  - We’ll add more ways to save your summaries, like directly to note tools such as Obsidian and Notion.
- **Control Your Own LLM**:
  - You'll be able to set up your own settings so Apogee uses a specific AI endpoint (like Local Ollama) with proper security measures.

## Later

- **Safari Support**:
  - We’ll look into how to make Apogee work on Safari computers.
- **Custom Extractors**:
  - You'll be able to load your own extractors directly in the settings without having to change the main code.

## Things We Won’t Do

- **Cloud Servers**: Apogee will never send, store, or process text from websites on remote servers.
- **Tracking Users**: We won’t track you or use any special tools to collect information about your browsing habits.
- **API Keys**: You don't need any keys to use Apogee – it works directly in your browser.

## How to Help

To help us build Apogee, check the open issues on GitHub or read CONTRIBUTING.md.
