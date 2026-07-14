# Apogee Backend

Local-first backend for the [Apogee](https://github.com/darshi1337/apogee)
browser extension, powered by [Ollama](https://ollama.com).

This is the **optional** "Local Ollama" mode. Apogee's default mode runs models
entirely in the browser via WebGPU and needs no backend at all — this package is
only for power users who want to run larger models (4B–8B+) locally. All traffic
stays on `127.0.0.1`; nothing is sent to the cloud.

## Requirements

- Python 3.10+
- [Ollama](https://ollama.com) installed and running

## Install

From a release artifact:

```bash
pip install apogee_browser-0.1.4-py3-none-any.whl
```

Or from source:

```bash
cd apogee-backend
pip install .
```

## Quick Start

```bash
apogee setup     # verify Ollama and pull the recommended models
apogee doctor    # diagnostics: Ollama install, connection, installed models
apogee           # start the server on http://127.0.0.1:8000
```

Then open the extension → **Settings** → select **Local Ollama** and point the
backend URL at `http://127.0.0.1:8000` (the default).

## CLI Commands

| Command         | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `apogee`        | Start the FastAPI server (default `127.0.0.1:8000`).             |
| `apogee setup`  | Check Ollama and pull the recommended models.                    |
| `apogee doctor` | Report Ollama status and which recommended models are installed. |

## Models

`apogee setup` pulls these; you can also pull them manually with `ollama pull <model>`:

| Model        | Pull command                 | Recommended for             |
| ------------ | ---------------------------- | --------------------------- |
| Gemma 3 (4B) | `ollama pull gemma3:4b`      | Lightweight, fast summaries |
| Qwen 3 8B    | `ollama pull qwen3:8b`       | Multi-turn chat & reasoning |
| Mistral (7B) | `ollama pull mistral:latest` | General language tasks      |
| Llama 3.1 8B | `ollama pull llama3.1:8b`    | General reasoning & coding  |

## HTTP API

The server exposes a small JSON API consumed by the extension. All `POST`
endpoints require the `X-Apogee-Client: 1` header (see Security below) and stream
their responses as plain text.

| Method | Path                 | Purpose                                                                                         |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `GET`  | `/health`            | Ollama connection status and installed models: `{ "connected": bool, "models": [...] }`.        |
| `GET`  | `/`                  | Redirects to `/health`.                                                                         |
| `POST` | `/summarize`         | Summarize page text. Body: `{ title, url, content, mode, model }`.                              |
| `POST` | `/ask`               | Answer a question about page content. Body: `{ title, url, content, question, model }`.         |
| `POST` | `/suggest-questions` | Suggest follow-up questions. Body: `{ title, url, summary, model }` → `{ "questions": [...] }`. |
| `POST` | `/pdf/url`           | Fetch and summarize a PDF by URL. Body: `{ url, mode, model }`.                                 |

`mode` is one of `bullets`, `sentences`, or `paragraphs`.

## Configuration

Configured entirely through environment variables:

| Variable                       | Default                             | Description                                                            |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------------------------- |
| `APOGEE_HOST`                  | `127.0.0.1`                         | Host to bind.                                                          |
| `APOGEE_PORT`                  | `8000`                              | Port to bind. If changed, update the extension's backend URL to match. |
| `APOGEE_ALLOW_LOCAL_PDFS`      | `1`                                 | Allow summarizing `file://` / local PDFs. Set to `0` to disable.       |
| `APOGEE_CORS_ORIGIN_REGEX`     | extension-shaped origins + loopback | Overrides the allowed CORS origin pattern.                             |
| `APOGEE_OLLAMA_HEALTH_TIMEOUT` | `3`                                 | Seconds to wait for the Ollama health check.                           |

## Development

```bash
cd apogee-backend
pip install -e .
pip install -r requirements.txt
pytest            # run the test suite
apogee            # run the server
```

## Project Layout

```
apogee/
  app.py            FastAPI app, CORS + client-header middleware
  cli.py            `apogee` / `setup` / `doctor` commands
  config.py         environment-variable configuration
  routes/           health, summarize/ask/suggest-questions, pdf
  services/         Ollama calls, chunking, summarization, PDF, prompts
  prompts/          prompt templates
  models/           Pydantic request models
```
