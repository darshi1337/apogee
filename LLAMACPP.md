# Local llama.cpp Setup Guide

Local llama.cpp mode connects Apogee directly to a `llama-server` instance running on your machine. It suits people who already run `llama.cpp` themselves: no wrapper around it, your own sampling flags, and whatever GGUF you point it at.

If you would rather not manage a server at all, [Local Ollama](OLLAMA.md) does the same job with model management built in. Both talk to your own machine over loopback and neither sends page content anywhere.

## How It Works

Apogee talks to `llama-server` over local HTTP (`http://127.0.0.1:8080` by default) using its OpenAI-compatible `/v1/chat/completions` endpoint. There is no intermediate service.

Unlike Ollama, `llama-server` serves exactly one model: the GGUF you launched it with. Apogee reads which one that is rather than asking you to pick from a list.

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

Wait for `listening on http://127.0.0.1:8080`. Keep the terminal open; the server runs in the foreground.

Apogee only connects to `127.0.0.1` and `localhost`. A server bound elsewhere is refused deliberately, so that page text cannot leave your machine.

## Step 3: Configure Apogee

1. Open Apogee and click the gear icon for **Settings**.
2. Under **AI Provider**, select **llama.cpp**.
3. Leave **Server URL** at `http://127.0.0.1:8080` unless you chose a different port.
4. The **Loaded Model** field fills in on its own once the server answers.

The status line under the model name tells you where you stand:

| What it says | What it means |
| --- | --- |
| Detected from the server, N token context | Connected, and Apogee knows the running context window |
| N models available | A proxy in front of `llama-server` is serving several |
| Connected, but the model could not be read. Check the API key | The server is up but `/v1/models` refused; usually a missing or wrong API key |
| Not connected | Nothing answered on that address |

## The Model Field

`llama-server` loads one model at launch, so there is no list to choose from. Apogee reads the name from `/v1/models` and fills the field in.

The field stays editable, and what you type is kept. That matters for two cases:

- A proxy such as [llama-swap](https://github.com/mostlygeek/llama-swap) routing to different backends by model name.
- A build whose `/v1/models` reports something that is not the name you need to send.

Auto-fill only writes into an **empty** field, so a name you typed is never overwritten. To ask for detection again, clear the field and reopen Settings.

## Context Window

`llama-server` takes its context window from the `-c` flag you launched it with, not from the model. The same GGUF serves 4096 tokens or 32768 depending on how you started it, and the file name reads the same either way.

Apogee therefore asks the server rather than guessing, reading `/props` and falling back to `/v1/models`. This is what keeps long pages from being chunked past what your server can accept:

```bash
llama-server -m model.gguf -c 4096    # Apogee sizes chunks for 4096
llama-server -m model.gguf -c 32768   # and for 32768 here
```

If neither endpoint reports a window (`/props` can be disabled server-side), Apogee assumes a conservative 8192 tokens, which is safe on any server but will under-use a larger one.

## CORS

Nothing to configure. `llama-server` handles CORS itself, reflecting the requesting origin and answering preflight requests, so Apogee reaches it with no flags or environment variables. This differs from Ollama, which needs its origin check worked around.

## API Key

Only if you started the server with one:

```bash
llama-server -m model.gguf --api-key your-key-here
```

Then put the same value in the **API key** field in Settings. Leave it empty otherwise, which is the usual case for a loopback server.

The key is stored with your other settings and sent only to the loopback address you configured. It is never included in a copied diagnostics report, which shows `set` or `unset` instead.

Note that `/health` stays public even with a key set, so a wrong key shows as **connected with no model name** rather than as a connection failure.

## Recommended Models

Any instruction-tuned GGUF works. Pick a quantisation your RAM or VRAM can hold.

| Model | Size | Command | Notes |
| --- | --- | --- | --- |
| Qwen 2.5 7B Instruct | ~4.7 GB | `llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M` | Strong multilingual summarisation |
| Llama 3.1 8B Instruct | ~4.9 GB | `llama-server -hf bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M` | Good reasoning on technical pages |
| Gemma 2 9B Instruct | ~5.8 GB | `llama-server -hf bartowski/gemma-2-9b-it-GGUF:Q4_K_M` | Fluent prose summaries |
| Qwen 2.5 0.5B Instruct | ~400 MB | `llama-server -hf Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M` | Fast, low memory, useful for trying the setup |

## Useful Flags

| Flag | Does |
| --- | --- |
| `-c N` | Context window. Apogee reads this and sizes chunks to match. |
| `-ngl N` | Layers to offload to GPU. `-ngl 99` offloads as many as fit. |
| `-t N` | CPU threads. |
| `--port N` | Port to listen on; match it in Settings. |
| `--api-key KEY` | Require a bearer token. |

## Troubleshooting

**"Could not connect to llama.cpp at ..."** — the server is not running, or is on a different port. Check its terminal, then `curl http://127.0.0.1:8080/health`, which should return `{"status":"ok"}`.

**Connected, but no model name** — `/v1/models` refused. With an API key configured on the server, check the key in Settings matches.

**"Disallowed llama.cpp host"** — the address is not `127.0.0.1` or `localhost`. Remote servers are refused so page text stays on your machine. To use one on another machine, forward its port first: `ssh -L 8080:localhost:8080 user@host`.

**Summaries truncated or the server complains about context** — launch with a larger `-c`, or check the context Apogee detected in the status line under the model name.

**Slow generation** — offload to GPU with `-ngl 99`, or use a smaller model or quantisation.

## Verified Against

The behaviour described here was checked against `llama-server` build `b10603-c060ca974`. Endpoint shapes have shifted between llama.cpp versions; if something here does not match your build, please open an issue.
