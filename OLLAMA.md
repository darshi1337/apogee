# Local Ollama Setup Guide

Local Ollama mode allows power users to connect Apogee directly to an Ollama instance running on their local machine. This enables running larger models (such as 4B to 8B+ parameter models) while keeping all text analysis completely private.

## How It Works

Apogee communicates directly with Ollama over local HTTP (`http://127.0.0.1:11434`). There is no intermediate backend application to configure or run.

## Step 1: Install Ollama

Install Ollama for your operating system:

- **macOS**: Download the application installer from [ollama.com/download](https://ollama.com/download) or run `brew install ollama` using Homebrew.
- **Windows**: Download and run the setup installer from [ollama.com/download](https://ollama.com/download).
- **Linux**: Install via terminal using `curl -fsSL https://ollama.com/install.sh | sh`.

## Step 2: Pull Your Models

Open your terminal and pull the AI models you want to use for summarization and Q&A:

```bash
ollama pull gemma3:4b
ollama pull qwen3:8b
ollama pull mistral:latest
ollama pull llama3.1:8b
```

## Step 3: Configure Apogee Settings

1. Open Apogee by clicking the extension icon.
2. Click the gear icon to open **Settings**.
3. Under **AI Provider**, select **Local Ollama**.
4. Keep the host field set to `http://127.0.0.1:11434` unless you configured Ollama to use a custom port.
5. Select your desired model from the **Local LLM** dropdown list.

## Automatic CORS Handling

Apogee connects to Ollama without requiring custom environment variables or CORS configuration:

- **Header Stripping Rule**: Apogee strips `Origin` headers from its own local loopback requests sent to `127.0.0.1` and `localhost`. Where the browser supports session-scoped rules, this is registered at runtime for requests originating from no tab (the extension's own background fetches), so other sites and local services are untouched; the bundled static rule remains as a fallback. The same handling covers llama.cpp.
- **Zero OLLAMA_ORIGINS Setup**: Because requests arrive without an `Origin` header, Ollama serves them without needing `OLLAMA_ORIGINS="*"` environment variables.
- **Security Sandboxing**: Stripping applies to the extension's own requests only, preserving security boundaries for other local development servers running on your machine.

## Dynamic Model Discovery

When Local Ollama mode is active, Apogee queries Ollama's local `/api/tags` endpoint to fetch your installed models in real time. Any new model you download via `ollama pull` appears automatically in Apogee settings.
