# Apogee Model Reference

Apogee gives you full control over how AI models run on your machine. You can choose between hardware accelerated WebGPU in your browser, lightweight WebAssembly for CPU compatibility, or connect to your own Local Ollama instance.

## Provider Overview

The table below summarizes the key technical differences between Apogee three supported AI provider engines.

| Provider        | Runtime Engine         | Internet Dependency        | Model Size Range      | Recommended Hardware Target                          |
| --------------- | ---------------------- | -------------------------- | --------------------- | ---------------------------------------------------- |
| WebLLM          | GPU via WebGPU         | First run weights download | 1B to 3.5B parameters | Chromium browsers on systems with dedicated GPUs     |
| Transformers.js | CPU via WebAssembly    | First run weights download | 360M to 1B parameters | Firefox, lightweight systems, or GPUs without WebGPU |
| Local Ollama    | Local machine via HTTP | None for extension         | 4B to 8B+ parameters  | Power users running Ollama locally over loopback     |
| Local llama.cpp | Local machine via HTTP | None for extension         | Any GGUF you load     | Power users running llama-server directly            |

## WebLLM GPU Models

WebLLM executes quantized open weights directly on your graphics card via WebGPU. On Chrome, Edge, Brave, Dia, Vivaldi, and Opera, WebLLM is the default provider.

| Model                   | Download Size | Best Suited For                            | Technical Notes                                            |
| ----------------------- | ------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Qwen 2.5 1.5B (Default) | ~900 MB       | Multilingual summarization and general Q&A | Excellent performance across non-English languages         |
| SmolLM2 1.7B            | ~1 GB         | General web content and article gists      | Balanced generation speed and output clarity               |
| Llama 3.2 1B            | ~700 MB       | Fast, lightweight summaries                | Smallest VRAM footprint for WebGPU models                  |
| Phi 3.5 Mini            | ~2.2 GB       | Complex technical documents and reasoning  | Strong reasoning capabilities with higher VRAM requirement |

## Transformers.js WebAssembly Models

Transformers.js runs ONNX models on CPU via WebAssembly. On Firefox, where WebExtensions lack offscreen document WebGPU support, Transformers.js runs directly in the background page and is the default provider. It is also available as an opt-in provider on Chromium browsers for machines without WebGPU.

| Model                  | Download Size | Best Suited For                 | Technical Notes                                      |
| ---------------------- | ------------- | ------------------------------- | ---------------------------------------------------- |
| SmolLM2 360M (Default) | ~270 MB       | Ultra fast CPU summaries        | Extremely light memory footprint for quick summaries |
| Qwen 2.5 0.5B          | ~480 MB       | Multilingual CPU summarization  | Provides compact multilingual capability on WASM     |
| Llama 3.2 1B           | ~1.2 GB       | Deeper reasoning on modern CPUs | Recommended for faster desktop CPUs                  |

Transformers.js context windows are capped at 4096 tokens to maintain fast generation times on CPU. The WASM runtime ships bundled directly inside the extension package without loading code from external CDNs.

## Local Ollama Recommended Models

When Local Ollama mode is selected, Apogee queries your local Ollama server over loopback HTTP (`http://127.0.0.1:11434`) and dynamically populates your available model dropdown from your pulled models.

| Model          | Model Size | Recommended Pull Command     | Primary Strengths                                           |
| -------------- | ---------- | ---------------------------- | ----------------------------------------------------------- |
| Gemma 3 4B     | ~4B        | `ollama pull gemma3:4b`      | Outstanding speed and high quality overall outputs          |
| Qwen 3 8B      | ~8B        | `ollama pull qwen3:8b`       | Excellent multilingual reasoning and long context handling  |
| Mistral Latest | ~7B        | `ollama pull mistral:latest` | Reliable language capability and technical summarization    |
| Llama 3.1 8B   | ~8B        | `ollama pull llama3.1:8b`    | High reasoning strength and technical context understanding |

## Local llama.cpp Models

When Local llama.cpp mode is selected, Apogee talks to your own `llama-server` over loopback HTTP (`http://127.0.0.1:8080`). Unlike Ollama it serves one model at a time, the GGUF you launched it with, so Apogee reads the name from the server instead of offering a list. See the [Local llama.cpp Guide](LLAMACPP.md) for setup.

| Model                  | Model Size | Recommended Start Command                                           | Primary Strengths                           |
| ---------------------- | ---------- | ------------------------------------------------------------------- | ------------------------------------------- |
| Qwen 2.5 7B Instruct   | ~4.7 GB    | `llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M`             | Strong multilingual summarization           |
| Llama 3.1 8B Instruct  | ~4.9 GB    | `llama-server -hf bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M` | Good reasoning on technical pages           |
| Gemma 2 9B Instruct    | ~5.8 GB    | `llama-server -hf bartowski/gemma-2-9b-it-GGUF:Q4_K_M`              | Fluent prose summaries                      |
| Qwen 2.5 0.5B Instruct | ~400 MB    | `llama-server -hf Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M`           | Fast and light, useful for trying the setup |

## Context Windows and Dynamic Content Chunking

Apogee dynamically adjusts page chunking strategies based on your active model context window limit:

- **Compact Context Models**: Smaller models with 2048 or 4096 token context windows use smaller text chunks with hierarchical map-reduce to synthesize final summaries. When an input produces more chunks than the model's `getMaxChunks` budget (4 for Transformers.js, 12 for Ollama), every chunk is mapped to a partial and partials are tree-folded in groups of `fanIn` until fewer than `maxChunks` remain before the final reduce, preserving full coverage instead of dropping material. The `{ stage: "truncated" }` progress event only fires when a custom `selectChunksFn` is provided; otherwise overflow is handled by the tree.
- **Servers That Report Their Own Window**: `llama-server` takes its context window from its `-c` launch flag rather than from the model, so the same GGUF can be serving 4096 tokens or 32768 with an identical name. Apogee asks the server (`/props`, falling back to `/v1/models`) and sizes chunks to what it reports, rather than inferring a window from the model name.
- **Large Context Models**: Models with large context windows (such as Ollama models supporting 32k or 128k tokens) receive larger text chunks, reducing processing passes and speeding up response generation on long pages.
- **OOM Resilience**: Map and reduce steps detect `out of memory` / `allocation failed` errors, emit `{ stage: "oom_fallback" }`, and fall back to already-collected partials (or concatenated intermediates for a final-reduce OOM) so a memory-constrained device still returns coverage of every chunk instead of failing.

## Performance Benchmarks

### WebLLM GPU Performance

- **Generation Speed**: ~30 to 50 tokens per second depending on GPU hardware.
- **Cold Load Time**: ~1 to 3 seconds once weights are cached locally.
- **First Run Download**: ~1 to 3 minutes depending on network bandwidth for model weight caching.

### Local Ollama Performance (Apple M2 Metal Acceleration)

- **Generation Speed**: ~73 tokens per second on `gemma3:4b`.
- **Cold Load Time**: ~0.25 seconds.
- **Short Page Summary**: ~1 to 1.5 seconds end to end.
- **Long Document Summary (40,000 characters)**: First summary bullets in ~2 seconds, complete process in ~12 seconds.
