# Apogee

**Apogee** is an AI browser assistant for articles, videos, emails, and more.
It runs **entirely in your browser** via WebGPU — no backend, no API keys,
no cloud. Just install the extension and go.

For power users, Apogee also supports a local Ollama backend with larger models.

## How It Works

Apogee uses [WebLLM](https://github.com/mlc-ai/web-llm) to run quantized
language models directly in your browser using WebGPU. The first time you use
it, the model weights (~700 MB – 2 GB depending on your choice) are downloaded
and cached locally. After that, everything runs offline.

## Quick Start

1. **Install the extension** (see below).
2. Open any webpage.
3. Click the Apogee icon → **Summarize this page**.
4. On first use, the model downloads automatically. After that it's instant.

That's it. No backend installation, no terminal commands.

## Supported In-Browser Models

| Model                   | Download Size | Best For                   |
| ----------------------- | ------------- | -------------------------- |
| Qwen 2.5 1.5B (default) | ~900 MB       | Multilingual summarization |
| SmolLM2 1.7B            | ~1 GB         | General tasks              |
| Llama 3.2 1B            | ~700 MB       | Lightweight, fast          |
| Phi 3.5 Mini            | ~2.2 GB       | Stronger reasoning         |

## Browser Requirements

- **Chrome 113+** or **Edge 113+** (WebGPU required)
- A GPU with WebGPU support (most modern GPUs)
- Firefox: WebGPU is not yet stable — use **Local Ollama** mode instead

## Install the Extension

### Chrome / Chromium (unpacked)

1. Clone or download this repository.
2. `cd apogee-extension && npm install && npm run build`
3. Go to `chrome://extensions`.
4. Enable **Developer mode** (top-right).
5. Click **Load unpacked** and select the `apogee-extension/dist` folder.

### Firefox (temporary add-on, Local Ollama mode only)

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `apogee-extension/dist/manifest.json`.
3. Open Settings → switch to **Local Ollama** mode (WebGPU is not supported).

## Advanced: Local Ollama Backend

If you prefer running larger models (8B+) locally through Ollama, Apogee still
supports that as a fallback.

### 1. Install Ollama

Install from https://ollama.com, then:

```bash
ollama pull gemma3:4b   # and qwen3:8b, mistral:latest, llama3.1:8b
```

### 2. Install Apogee Backend

```bash
pip install apogee-browser==0.2.0
```

### 3. Start the Backend

```bash
apogee
```

### 4. Switch the Extension

Open the extension → Settings → select **Local Ollama** → set the URL
(defaults to `http://127.0.0.1:8000`).

### Custom Port

```bash
APOGEE_PORT=8123 apogee
```

Update the extension backend URL to match.

### Performance (Apple Silicon)

Measured locally on an Apple M2 (`gemma3:4b`, GPU via Metal):

| Metric                              | Value                              |
| ----------------------------------- | ---------------------------------- |
| Generation throughput               | ~73 tokens/s                       |
| Model cold-load                     | ~0.25 s                            |
| Short page / question               | ~1–1.5 s end to end                |
| Long page (~40k chars, multi-chunk) | first bullets in ~2 s, ~12 s total |

## Privacy & Permissions

- **In-Browser mode**: All inference happens on your device. No data leaves
  your browser. Model weights are cached in browser storage.
- **Local Ollama mode**: Data goes only to `127.0.0.1` (your own machine).
- **`activeTab` + `scripting`**: Page content is read only from the current tab,
  only when you click Summarize/Ask.
- **`storage`**: Used only for settings and cached summaries.
- **No telemetry. No analytics. No cloud.**

## Development

```bash
cd apogee-extension
npm install
npm run dev    # watch mode — rebuilds on changes
```

Load the `dist/` folder as an unpacked extension in Chrome.
