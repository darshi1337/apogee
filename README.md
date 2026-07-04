# Apogee

**Apogee** is a local-first AI browser assistant inspired by Mozilla Orbit. It helps users summarize webpages, PDFs, emails, and YouTube content using open-source language models running locally through Ollama.

Unlike cloud-based AI assistants, Apogee keeps your data on your machine. Content is processed through locally running models, giving you complete control over your privacy, models, and infrastructure.

## Supported Models

Apogee currently supports:

- Qwen 3 8B
- Mistral
- Llama 3.1 8B
- Gemma 3

All models are served locally using Ollama.

## Installation

### 1. Install Ollama

Install Ollama from:

https://ollama.com

Verify installation:

```bash
ollama --version
```

### 2. Install Apogee

```bash
pip install apogee-browser==0.1.0
```

### 3. Download Models

```bash
apogee setup
```

### 4. Start Apogee

```bash
apogee
```

## Running on macOS (Apple Silicon)

Apogee runs well on Apple Silicon (M1/M2/M3). Ollama uses the GPU via Metal
automatically, so no extra configuration is needed.

```bash
# 1. Install Ollama and a Python 3.10+ interpreter
brew install ollama python@3.11

# 2. Start the Ollama server (leave running, or use: brew services start ollama)
ollama serve &

# 3. Pull a model (gemma3:4b is the lightest; good for 8 GB machines)
ollama pull gemma3:4b

# 4. Create an isolated environment and install the backend
python3.11 -m venv ~/apogee-env
source ~/apogee-env/bin/activate
pip install apogee-browser==0.1.0   # or: pip install -e apogee-backend

# 5. Start the backend
apogee
```

Verify it is up: open <http://127.0.0.1:8000/health> — it should report
`{"connected": true, "models": [...]}`.

### Custom port

If port 8000 is already in use, start the backend on another port:

```bash
APOGEE_PORT=8123 apogee
```

If you change the port, update the endpoint the browser extension talks to
accordingly (it defaults to `http://127.0.0.1:8000`).

## Browser Extension

Install the Apogee browser extension and connect it to the local backend.
The extension communicates only with:

```text
http://127.0.0.1:8000
```

No user content is sent to external AI providers.

### Load in Chrome / Chromium (unpacked)

The extension is Manifest V3 and works in Chrome as well as Firefox.

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `apogee-extension` folder.
4. Make sure the model selected in the extension's Settings matches a model you
   pulled with `ollama pull` (e.g. Gemma 3 for `gemma3:4b`).

### Load in Firefox (temporary add-on)

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `apogee-extension/manifest.json`.

## Usage

### Summarize a Webpage

1. Open any webpage.
2. Click the Apogee extension.
3. Press **Summarize**.
