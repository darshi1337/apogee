# Apogee Model Reference

Apogee gives you full control over how AI models run on your machine. Pick between hardware-accelerated WebGPU in your browser, light WebAssembly for CPU use, or your own Local Ollama instance or llama-server.

## Provider Overview

The table below sums up the main technical differences between the four supported AI provider engines in Apogee.

| Provider | Runtime Engine | Internet Dependency | Model Size Range | Recommended Hardware Target |
| --- | --- | --- | --- | --- |
| WebLLM | GPU via WebGPU | First run weights download | 1B to 3.5B parameters | Chromium browsers on systems with dedicated GPUs |
| Transformers.js | CPU via WebAssembly | First run weights download | 360M to 1B parameters | Firefox, light systems, or GPUs without WebGPU |
| Local Ollama | Local machine via HTTP | None for extension | 4B to 8B+ parameters | Power users running Ollama locally over loopback |
| Local llama.cpp | Local machine via HTTP | None for extension | Any GGUF you load | Power users running llama-server directly |

## WebLLM GPU Models

WebLLM runs compact open weights straight on your graphics card through WebGPU. On Chrome, Edge, Brave, Dia, Vivaldi, and Opera, WebLLM is the default provider.

| Model | Download Size | Best Suited For | Technical Notes |
| --- | --- | --- | --- |
| Qwen 2.5 1.5B (Default) | ~900 MB | Multilingual summarization and general Q&A | Strong results across non-English languages |
| SmolLM2 1.7B | ~1 GB | General web content and article gists | Balanced speed and output clarity |
| Llama 3.2 1B | ~700 MB | Fast, light summaries | Smallest VRAM use for WebGPU models |
| Phi 3.5 Mini | ~2.2 GB | Complex technical documents and reasoning | Strong reasoning with higher VRAM need |

## Transformers.js WebAssembly Models

Transformers.js runs ONNX models on CPU through WebAssembly. On Firefox, where WebExtensions lack offscreen document WebGPU support, Transformers.js runs straight in the background page and is the default provider. It is also an opt-in provider on Chromium browsers for machines without WebGPU.

| Model | Download Size | Best Suited For | Technical Notes |
| --- | --- | --- | --- |
| SmolLM2 360M (Default) | ~270 MB | Very fast CPU summaries | Very light memory use for quick summaries |
| Qwen 2.5 0.5B | ~480 MB | Multilingual CPU summarization | Compact multilingual use on WASM |
| Llama 3.2 1B | ~1.2 GB | Deeper reasoning on modern CPUs | Suited for faster desktop CPUs |

Transformers.js context windows are capped at 4096 tokens to keep generation fast on CPU. The WASM runtime ships bundled straight inside the extension package without loading code from outside CDNs.

## Local Ollama Recommended Models

When Local Ollama mode is picked, Apogee queries your local Ollama server over loopback HTTP (`http://127.0.0.1:11434`) and fills your model dropdown from your pulled models on its own.

| Model | Model Size | Recommended Pull Command | Primary Strengths |
| --- | --- | --- | --- |
| Gemma 3 | ~4B | `ollama pull gemma3:4b` | Fast speed and high quality outputs overall |
| Qwen 3 8B | ~8B | `ollama pull qwen3:8b` | Strong multilingual reasoning and long context handling |
| Mistral Latest | ~7B | `ollama pull mistral:latest` | Stable language handling and technical summarization |
| Llama 3.1 8B | ~8B | `ollama pull llama3.1:8b` | Strong reasoning and technical context handling |

## Local llama.cpp Models

When Local llama.cpp mode is picked, Apogee talks to your own `llama-server` over loopback HTTP (`http://127.0.0.1:8080`). Unlike Ollama it serves one model at a time, the GGUF you launched it with, so Apogee reads the name from the server instead of showing a list. See the [Local llama.cpp Guide](LLAMACPP.md) for setup.

| Model | Model Size | Recommended Start Command | Primary Strengths |
| --- | --- | --- | --- |
| Qwen 2.5 7B Instruct | ~4.7 GB | `llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M` | Strong multilingual summarization |
| Llama 3.1 8B Instruct | ~4.9 GB | `llama-server -hf bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M` | Good reasoning on technical pages |
| Gemma 2 9B Instruct | ~5.8 GB | `llama-server -hf bartowski/gemma-2-9b-it-GGUF:Q4_K_M` | Fluent prose summaries |
| Qwen 2.5 0.5B Instruct | ~400 MB | `llama-server -hf Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M` | Fast and light, useful for trying the setup |

## Context Windows and Dynamic Content Chunking

Apogee adjusts page chunking based on your active model context window limit:

- **Compact Context Models**: Smaller models with 2048 or 4096 token context windows use smaller text chunks with hierarchical map-reduce to build final summaries. When an input makes more chunks than the model `getMaxChunks` budget (4 for Transformers.js, 12 for Ollama), each chunk is mapped to a partial and partials are tree-folded in groups of `fanIn` until fewer than `maxChunks` remain before the final reduce. This keeps full coverage instead of dropping text. The `{ stage: "truncated" }` progress event only fires when a custom `selectChunksFn` is given. If not, overflow is handled by the tree.
- **Servers That Report Their Own Window**: `llama-server` takes its context window from its `-c` launch flag instead of from the model, so the same GGUF can serve 4096 tokens or 32768 with the same name. Apogee asks the server (`/props`, falling back to `/v1/models`) and sizes chunks to what it reports, instead of guessing a window from the model name.
- **Large Context Models**: Models with large context windows (such as Ollama models with 32k or 128k tokens) get larger text chunks, cutting processing passes and speeding up responses on long pages.
- **OOM Resilience**: Map and reduce steps catch `out of memory` / `allocation failed` errors, emit `{ stage: "oom_fallback" }`, and fall back to already-collected partials (or joined intermediates for a final-reduce OOM) so a memory-limited device still returns coverage of each chunk instead of failing.

## Performance Benchmarks

### WebLLM GPU Performance

- **Generation Speed**: About 30 to 50 tokens per second based on GPU hardware.
- **Cold Load Time**: About 1 to 3 seconds once weights are cached locally.
- **First Run Download**: About 1 to 3 minutes based on network speed for model weight caching.

### Local Ollama Performance (Apple M2 Metal Acceleration)

- **Generation Speed**: About 73 tokens per second on `gemma3:4b`.
- **Cold Load Time**: About 0.25 seconds.
- **Short Page Summary**: About 1 to 1.5 seconds end to end.
- **Long Document Summary (40,000 characters)**: First summary bullets in about 2 seconds, full run in about 12 seconds.
