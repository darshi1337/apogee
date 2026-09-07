# Local Ollama Setup Guide

Local Ollama mode lets advanced users connect Apogee directly to an Ollama instance running on their own computer. This way, they can run bigger models (like those with 4 billion to 8 billion+ parameters) while keeping all text analysis private.

## How It Works

Apogee talks directly to Ollama using the internet (`http://127.0.0.1:11434`). There's no other program that needs to be set up or run.

## Step 1: Install Ollama

Install Ollama for your computer:

- **macOS**: Download the installer from [https://ollama.com/download](https://ollama.com/download) or use `brew install ollama` with Homebrew.
- **Windows**: Download and run the setup installer from [https://ollama.com/download](https://ollama.com/download).
- **Linux**: Use the terminal to install: `curl -fsSL https://ollama.com/install.sh | sh`.

## Step 2: Pull Your Models

Open your terminal and get the AI models you want to use for summarizing text and answering questions:

```bash
ollama pull gemma3:4b
ollama pull qwen3:8b
ollama pull mistral:latest
ollama pull llama3.1:8b
```

## Step 3: Configure Apogee Settings

1. Open Apogee by clicking the extension icon.
2. Click the gear icon to open **Settings**.
3. Under **AI Provider**, choose **Local Ollama**.
4. Make sure the host field is set to `http://127.0.0.1:11434`. Change this only if you changed the port that Ollama uses.
5. Pick your desired model from the **Local LLM** dropdown list.

## Automatic CORS Handling

Apogee connects to Ollama without needing extra settings or complicated configurations:

- **Header Stripping Rule**: Apogee removes the `Origin` header from its own requests sent to `127.0.0.1` and `localhost`. If your browser supports special rules for temporary connections, this is set up automatically. This protects other websites and local services. The same rule works with llama.cpp.
- **Zero OLLAMA_ORIGINS Setup**: Because requests don't have an `Origin` header, Ollama doesn’t need the `OLLAMA_ORIGINS="*"` environment variable.
- **Security Sandboxing**: This header stripping only applies to Apogee's own requests, keeping your computer safe from other programs running on it.

## Dynamic Model Discovery

When Local Ollama mode is active, Apogee checks Ollama’s local `/api/tags` endpoint to find all the models you have installed. Any new model you download with `ollama pull` appears automatically in Apogee settings.
