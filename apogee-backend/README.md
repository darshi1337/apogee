# Apogee Backend

Local-first backend for the [Apogee](https://github.com/darshi1337/apogee)
browser extension, powered by [Ollama](https://ollama.com).

This is the **optional** "Local Ollama" mode. Apogee's default mode runs models
entirely in the browser via WebGPU and needs no backend at all, this package is
only for power users who want to run larger models (4B–8B+) locally. All traffic
stays on `127.0.0.1`; nothing is sent to the cloud.

## Requirements

- Node.js 20+
- [Ollama](https://ollama.com) installed and running

## Install

```bash
cd apogee-backend
npm install
```

## Quick Start

```bash
node bin/cli.js setup     # verify Ollama and pull the recommended models
node bin/cli.js doctor    # diagnostics: Ollama install, connection, installed models
npm start                 # start the server on http://127.0.0.1:8000
```

Or install it globally (exposes the `apogee` command directly, matching the
`bin` entry in `package.json`):

```bash
npm install -g .
apogee setup
apogee doctor
apogee
```

Then open the extension → **Settings** → select **Local Ollama** and point the
backend URL at `http://127.0.0.1:8000` (the default).

## CLI Commands

| Command                  | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `node bin/cli.js`        | Start the Express server (default `127.0.0.1:8000`).             |
| `node bin/cli.js setup`  | Check Ollama and pull the recommended models.                    |
| `node bin/cli.js doctor` | Report Ollama status and which recommended models are installed. |

## Models

`setup` pulls these; you can also pull them manually with `ollama pull <model>`:

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

## Security

The server binds to `127.0.0.1` by default and expects its only client to be
the Apogee extension, but it still defends against other local software (or a
malicious webpage) reaching it:

- **CORS**: only origins shaped like the extension's own (`chrome-extension://...`,
  `moz-extension://...`) are allowed by default, not `localhost`/`127.0.0.1`
  pages, which would otherwise let any local dev server or app read your PDFs
  and summaries. See `APOGEE_CORS_ORIGIN_REGEX` above to widen this.
- **`X-Apogee-Client` header**: every `POST` request must carry this header.
  It isn't a secret, but a plain `<form>` submit or a "simple" (non-preflighted)
  cross-origin `fetch` can't set custom headers, so this forces even a
  same-shaped-origin request through a CORS preflight the origin regex must
  approve first, defense-in-depth alongside the CORS check above.
- **Remote PDF downloads (`POST /pdf/url`)**: the target must resolve to a
  public IP (loopback/private/link-local/etc. ranges are rejected), and every
  redirect hop is re-validated and DNS-pinned independently, so a URL that
  passes the initial check can't 302 its way to an internal service. Downloads
  are capped at 50MB and a 30s wall-clock deadline per hop.
- **Local PDF access (`file://` URLs)**: restricted to the OS temp directory
  and `~/Downloads` by default (see `APOGEE_PDF_ALLOWED_DIRS` above to widen
  this, or `APOGEE_ALLOW_LOCAL_PDFS=0` to disable it entirely), resolved
  through `realpath` so symlinks can't escape the allowed roots, and must end
  in `.pdf`.

## Configuration

Configured entirely through environment variables:

| Variable                       | Default                                  | Description                                                                                                                                 |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `APOGEE_HOST`                  | `127.0.0.1`                              | Host to bind.                                                                                                                               |
| `APOGEE_PORT`                  | `8000`                                   | Port to bind (1-65535). If changed, update the extension's backend URL to match.                                                            |
| `APOGEE_ALLOW_LOCAL_PDFS`      | `1`                                      | Allow summarizing `file://` / local PDFs. Set to `0`/`false`/`no`/`off` to disable.                                                         |
| `APOGEE_CORS_ORIGIN_REGEX`     | extension-shaped origins + loopback      | Overrides the allowed CORS origin pattern.                                                                                                  |
| `APOGEE_OLLAMA_HEALTH_TIMEOUT` | `3`                                      | Seconds to wait for the Ollama health check.                                                                                                |
| `APOGEE_OLLAMA_KEEP_ALIVE`     | `5m`                                     | How long Ollama keeps a model resident in memory after a request (Ollama duration syntax, e.g. `10m`/`1h`, or `-1` to pin it indefinitely). |
| `APOGEE_PDF_ALLOWED_DIRS`      | _(none)_                                 | Extra colon-separated directories allowed for local `file://` PDF access, in addition to the OS temp dir and `~/Downloads`.                 |
| `OLLAMA_HOST`                  | Ollama's own default (`127.0.0.1:11434`) | Address of the Ollama server to connect to, if it's not running on the default host/port.                                                   |

## Development

```bash
cd apogee-backend
npm install
npm test    # run the test suite
npm start   # run the server
```

## Project Layout

```
bin/
  cli.js            `apogee` / `setup` / `doctor` commands
src/
  app.js            Express app, CORS + client-header middleware
  config.js         environment-variable configuration
  routes/           health, summarize/ask/suggest-questions, pdf
  services/         Ollama calls, chunking, summarization, PDF, prompts
  prompts/          prompt templates
  models/           zod request schemas
  utils/            shared helpers (cleaner, IPv4 checks, HTTP errors)
```

## Packaging a Release

The backend isn't published to the npm registry, it's installed via
`git clone` + `npm install -g .` (see above). To produce a distributable
tarball for a GitHub release (mirroring the extension's `.zip`/`.xpi`):

```bash
cd apogee-backend
npm pack
```

This writes `apogee-browser-<version>.tgz` to the current directory (no
`.npmignore`/`files` field is set, so it includes `bin/`, `src/`, and
`tests/`, the full package). The file is gitignored (`*.tgz`); attach it to
the GitHub release manually alongside the extension artifacts.
