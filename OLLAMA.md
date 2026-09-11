# Local Ollama Setup Guide

Local Ollama mode lets advanced users connect Apogee directly to an Ollama instance running on their own computer. This way, they run bigger models (like those with 4 billion to 8 billion+ parameters). All text analysis stays private.

## How It Works

Apogee talks directly to Ollama over HTTP (`http://127.0.0.1:11434`). It needs no other program.

## Step 1: Install Ollama

Install Ollama for your computer:

- **macOS**: Download the installer from [https://ollama.com/download](https://ollama.com/download) or use `brew install ollama` with Homebrew.

- **Windows**: Download and run the setup installer from [https://ollama.com/download](https://ollama.com/download).

- **Linux**: Use the terminal to install: `curl -fsSL https://ollama.com/install.sh | sh`.

## Step 2: Pull Your Models

Open your terminal. Get the AI models for summaries and answers:

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
4. Set the host field to `http://127.0.0.1:11434`. Change it only if you changed the port that Ollama uses.
5. Pick your desired model from the **Local LLM** dropdown list.

## Automatic CORS Handling

Apogee connects to Ollama without needing extra settings or complicated configurations:

- **Header Stripping Rule**: Apogee removes the `Origin` header from its own requests sent to `127.0.0.1` and `localhost`. If your browser supports special rules for temporary connections, setup runs on its own. This protects other websites and local services. The same rule works with llama.cpp.

- **Zero OLLAMA_ORIGINS Setup**: Requests carry no `Origin` header, so Ollama needs no `OLLAMA_ORIGINS="*"` environment variable.

- **Security Sandboxing**: This rule touches only requests from Apogee itself. It keeps your computer safe from other programs on it.

## Dynamic Model Discovery

When Local Ollama mode is active, Apogee checks the local `/api/tags` endpoint of Ollama. It finds all installed models. Any new model from `ollama pull` appears in Apogee settings on its own.
