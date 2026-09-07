# Local llama.cpp Setup Guide

Local llama.cpp mode links Apogee straight to a `llama-server` instance running on your machine. It fits people who already run `llama.cpp` themselves: no wrapper around it, your own sampling flags, and whatever GGUF you point it at.

If you would rather not manage a server at all, [Local Ollama](OLLAMA.md) does the same job with model management built in. Both talk to your own machine over loopback and neither sends page content anywhere.

## How It Works

Apogee talks to `llama-server` over local HTTP (`http://127.0.0.1:8080` by default) using its OpenAI-compatible `/v1/chat/completions` endpoint. No middle service sits between.

Unlike Ollama, `llama-server` serves exactly one model: the GGUF you launched it with. Apogee reads which one that is instead of asking you to pick from a list.

## Step 1: Install llama.cpp

- **Windows**: `winget install ggml.llamacpp`
- **macOS**: `brew install llama.cpp`
- **Linux**: [prebuilt releases](https://github.com/ggml-org/llama.cpp/releases), or build from source
- **Docker**: `ghcr.io/ggml-org/llama.cpp:server`

## Step 2: Start the Server

Point it at a local GGUF file:

```bash
llama-server -m /path/to/model.gguf --port 8080 --host 127.0.0.1
```

Or let it fetch one from Hugging Face on first run and cache it:

```bash
llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8080 --host 127.0.0.1
```

Wait for `listening on http://127.0.0.1:8080`. Keep the terminal open. The server runs in the foreground.

Apogee only links to `127.0.0.1` and `localhost`. A server bound elsewhere is refused on purpose, so page text cannot leave your machine.

## Step 3: Configure Apogee

1. Open Apogee and click the gear icon for **Settings**.
2. Under **AI Provider**, pick **llama.cpp**.
3. Leave **Server URL** at `http://127.0.0.1:8080` unless you picked a different port.
4. The **Loaded Model** field fills in on its own once the server answers.

The status line under the model name tells you where you stand:

| What it says | What it means |
| --- | --- |
| Detected from the server, N token context | Linked, and Apogee knows the running context window |
| N models available | A proxy in front of `llama-server` is serving several |
| Connected, but the model could not be read. Check the API key | The server is up but `/v1/models` refused. Often a missing or wrong API key |
| Not connected | Nothing answered on that address |

## The Model Field

`llama-server` loads one model at launch, so there is no list to pick from. Apogee reads the name from `/v1/models` and fills the field in.

The field stays editable, and what you type is kept. That matters for two cases:

- A proxy such as [llama-swap](https://github.com/mostlygeek/llama-swap) routing to different backends by model name.
- A build whose `/v1/models` reports something that is not the name you need to send.

Auto-fill only writes into an **empty** field, so a name you typed is never overwritten. To ask for detection again, clear the field and reopen Settings.

## Context Window

`llama-server` takes its context window from the `-c` flag you launched it with, not from the model. The same GGUF serves 4096 tokens or 32768 based on how you started it, and the file name reads the same either way.

Apogee thus asks the server instead of guessing, reading `/props` and falling back to `/v1/models`. This keeps long pages from being chunked past what your server can take:

```bash
llama-server -m model.gguf -c 4096    # Apogee sizes chunks for 4096
llama-server -m model.gguf -c 32768   # and for 32768 here
```

If neither endpoint reports a window (`/props` can be turned off server-side), Apogee assumes a careful 8192 tokens, which is safe on any server but will under-use a larger one.

## CORS

Nothing to set up. `llama-server` handles CORS itself, reflecting the asking origin and answering preflight requests, so Apogee reaches it with no flags or env vars. This differs from Ollama, which needs its origin check worked around.

## API Key

Only if you started the server with one:

```bash
llama-server -m model.gguf --api-key your-key-here
```

Then put the same value in the **API key** field in Settings. Leave it empty if not, which is the common case for a loopback server.

The key is stored with your other settings and sent only to the loopback address you set. It is never part of a copied diagnostics report, which shows `set` or `unset` instead.

Note that `/health` stays public even with a key set, so a wrong key shows as **linked with no model name** instead of as a link failure.

## Recommended Models

Any instruction-tuned GGUF works. Pick a size your RAM or VRAM can hold.

| Model | Size | Command | Notes |
| --- | --- | --- | --- |
| Qwen 2.5 7B Instruct | ~4.7 GB | `llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M` | Strong multilingual summarization |
| Llama 3.1 8B Instruct | ~4.9 GB | `llama-server -hf bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M` | Good reasoning on technical pages |
| Gemma 2 9B Instruct | ~5.8 GB | `llama-server -hf bartowski/gemma-2-9b-it-GGUF:Q4_K_M` | Fluent prose summaries |
| Qwen 2.5 0.5B Instruct | ~400 MB | `llama-server -hf Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M` | Fast, low memory, useful for trying the setup |

## Useful Flags

| Flag | Does |
| --- | --- |
| `-c N` | Context window. Apogee reads this and sizes chunks to match. |
| `-ngl N` | Layers to offload to GPU. `-ngl 99` offloads as many as fit. |
| `-t N` | CPU threads. |
| `--port N` | Port to listen on. Match it in Settings. |
| `--api-key KEY` | Ask for a bearer token. |

## Troubleshooting

**"Could not connect to llama.cpp at ..."**: the server is not running, or it uses a different port. Check its terminal, then `curl http://127.0.0.1:8080/health`, which should return `{"status":"ok"}`.

**Linked, but no model name**: `/v1/models` refused. With an API key set on the server, check the key in Settings matches.

**"Disallowed llama.cpp host"**: the address is not `127.0.0.1` or `localhost`. Remote servers are refused so page text stays on your machine. To use one on another machine, forward its port first: `ssh -L 8080:localhost:8080 user@host`.

**Summaries cut short or the server complains about context**: launch with a larger `-c`, or check the context Apogee found in the status line under the model name.

**Slow generation**: offload to GPU with `-ngl 99`, or use a smaller model or size.

## Verified Against

The steps stated here were checked against `llama-server` build `b10603-c060ca974`. Endpoint shapes have shifted between llama.cpp versions. If something here does not match your build, please open an issue.
