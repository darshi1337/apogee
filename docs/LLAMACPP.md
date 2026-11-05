# Local llama.cpp Setup Guide

Local llama.cpp mode links Apogee directly to a `llama-server` instance on your machine. It fits people who already run `llama.cpp` themselves. No wrapper sits around it. Your sampling flags stay. Point it at any GGUF.

If you prefer no server management at all, [Local Ollama](OLLAMA.md) does the same job. It includes built-in model management. Both talk to your own machine over loopback and neither sends page content elsewhere.

## How It Works

Apogee talks to `llama-server` over local HTTP (`http://127.0.0.1:8080` by default) through its OpenAI-compatible `/v1/chat/completions` endpoint. No middle service sits between.

By default, `llama-server` serves one model: the GGUF you launched it with, and Apogee reads the name automatically. When `llama-server` runs in router mode with multiple models, Apogee detects all available models and provides a model picker in Settings.

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

### Router Mode (Multiple Models)

`llama-server` supports router mode to host multiple models simultaneously without specifying `-m` at launch ([llama.cpp router documentation](https://github.com/ggml-org/llama.cpp/tree/master/tools/server#using-multiple-models)):

```bash
llama-server --models-dir /path/to/models --port 8080 --host 127.0.0.1
```

When started in router mode, `/v1/models` returns all models available in the directory. Apogee detects them and provides a model dropdown in Settings, routing chat and summarization requests to whichever model you select.

Apogee only links to loopback addresses (`127.0.0.1`, `localhost`, `[::1]`). It refuses servers bound elsewhere on purpose. Page text cannot leave your machine.

## Step 3: Configure Apogee

1. Open Apogee. Click the gear icon for **Settings**.
2. Under **AI Provider**, pick **llama.cpp**.
3. Leave **Server URL** at `http://127.0.0.1:8080` unless you picked a different port.
4. The **Loaded Model** field fills in on its own once the server answers.

The status line under the model name tells you where you stand:

| What it says | What it means |
| --- | --- |
| Detected from the server, N token context | Linked, and Apogee knows the running context window |
| N models available | A router-mode server or proxy serves several |
| Connected, but Apogee could not read the model. Check the API key | The server is up, but `/v1/models` refused. Often a missing or wrong API key causes this |
| Not connected | Nothing answered on that address |

## The Model Field

When `llama-server` serves a single model, Apogee reads the name from `/v1/models` and fills the field in. If the server serves multiple models (router mode or a multi-model proxy), a **Detected models** menu appears above the field, populated with everything `/v1/models` reports. Choosing one fills the field.

The field stays editable, and Apogee keeps what you type. The menu is only a shortcut for the names the server lists; type in the field when the name you need is not there. That matters for two cases:

- A proxy such as [llama-swap](https://github.com/mostlygeek/llama-swap) routing to different backends by model name.
- A build whose `/v1/models` reports something that is not the name you need to send.

Auto-fill only writes into an **empty** field, so a name you typed is never overwritten. To ask for detection again, clear the field. Then reopen Settings.

## Context Window

`llama-server` takes its context window from the `-c` flag you launched it with, not from the model. The same GGUF serves 4096 tokens or 32768 based on how you started it. The file name reads the same either way.

Apogee thus asks the server instead of guessing, reading `/props` and falling back to `/v1/models`. When several models are listed, it uses the smallest reported window so chunks fit whichever model you select. This keeps long pages inside what your server takes:

```bash
llama-server -m model.gguf -c 4096    # Apogee sizes chunks for 4096
llama-server -m model.gguf -c 32768   # and for 32768 here
```

If neither endpoint reports a window (you can turn `/props` off server-side), Apogee assumes a careful 8192 tokens. That is safe on any server but under-uses a larger one.

## CORS

Nothing to set up. `llama-server` handles CORS itself. It reflects the asking origin and answers preflight requests. Apogee reaches it with no flags and no env vars. This differs from Ollama, which needs its origin check worked around.

## API Key

Only if you started the server with one:

```bash
llama-server -m model.gguf --api-key your-key-here
```

Then put the same value in the **API key** field in Settings. Leave it empty if not, which is the common case for a loopback server.

The key stays with your other settings. Apogee sends it only to the loopback address you set. It never enters a copied diagnostics report. The report shows `set` or `unset` instead.

Note that `/health` stays public even with a key set. A wrong key shows as **linked with no model name** instead of as a link failure.

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

**"Could not connect to llama.cpp at ..."**: the server is not running, or it uses a different port. Check its terminal. Then `curl http://127.0.0.1:8080/health`. It returns `{"status":"ok"}` on a live server.

**Linked, but no model name**: `/v1/models` refused. With an API key set on the server, check that the key in Settings matches.

**"Disallowed llama.cpp host"**: the address is not a loopback address (`127.0.0.1`, `localhost`, or `[::1]`). Apogee refuses remote servers, so page text stays on your machine. To use one on another machine, forward its port first: `ssh -L 8080:localhost:8080 user@host`.

**Summaries cut short or the server complains about context**: Launch with a larger `-c`. Then check the context Apogee found in the status line under the model name.

**Slow generation**: Offload to GPU with `-ngl 99`. You can also use a smaller model or size.

## Verified Against

Maintainers checked the steps stated here against `llama-server` build `b10603-c060ca974`. Endpoint shapes shifted between llama.cpp versions. If something here does not match your build, please open an issue.
