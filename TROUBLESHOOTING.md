# Troubleshooting

Something not working? Find your symptom below. Each section states what to check first and where to read next. For the exact wording of a popup message, read the [Error Messages Guide](ERROR.md).

If nothing below fits, skip to [Still stuck](#still-stuck).

## WebGPU is unavailable

The default Apogee provider on Chromium browsers (WebLLM) needs WebGPU. If the popup reports no WebGPU support:

1. Open Settings. Switch the provider to In-Browser (Transformers.js). It runs on CPU through WebAssembly and needs no GPU.

2. If you want WebGPU back, check the [Browser Support](BROWSERS.md) table. On Brave you may need to turn WebGPU on under `brave://flags`. Updating your GPU driver sometimes brings WebGPU back on Chrome.

3. On Firefox there is no WebLLM at all. Firefox lacks the offscreen-document support WebLLM needs, so Transformers.js is the default there. Expect this. It is not a bug.

## The model download keeps stalling

The first in-browser run downloads the model, which can be several hundred megabytes. If progress stalls or restarts:

1. Wait and try again. Apogee retries a stalled download on its own (up to four attempts). It keeps the parts it already saved. A retry resumes instead of starting over.

2. If every attempt fails, suspect the network path. A VPN, a captive portal, or a strict proxy is the usual cause. Try a plain connection and retry.

3. If downloads keep failing on your machine, switch to Local Ollama or llama.cpp in Settings. Those run outside the browser and skip the download entirely. See the [Local Ollama Guide](OLLAMA.md) and the [Local llama.cpp Guide](LLAMACPP.md).

## Apogee cannot reach Ollama

If Settings shows the model list as defaults, or summaries fail with a connection error:

1. Check that Ollama runs: `ollama serve`. Then check the host in Apogee Settings matches where Ollama listens (default `http://localhost:11434`).

2. Check you have a model pulled: `ollama list`. If the list is empty, run `ollama pull <model>` (for example `ollama pull llama3.2`).

3. Apogee only talks to Ollama over plain http on localhost or 127.0.0.1. Apogee refuses remote hosts on purpose, so page text never leaves your machine. To use a remote server, forward its port over ssh (for example `ssh -L 11434:localhost:11434 ...`). Point Apogee at localhost.

4. The same three rules apply to llama.cpp. Defaults for llama.cpp: `llama-server` at `http://127.0.0.1:8080`. Health check: `curl http://127.0.0.1:8080/health`. If the server uses `--api-key`, the key in Settings must match.

Setup steps per operating system are in the [Local Ollama Guide](OLLAMA.md).

## Firefox is slow

Firefox runs the Transformers.js provider on CPU, so generation speed depends on your processor. If summaries take very long:

1. Use the smallest model that still gives good summaries. SmolLM2 360M (the default, about 270 MB) is the fastest. Larger CPU models suit faster desktop CPUs.

2. Summarize shorter pages or parts. Apogee processes long pages in chunks. Each chunk costs CPU time. The Transformers.js context window caps at 4096 tokens to keep generation fast.

3. If you have a GPU and want faster local runs, use Chrome or Edge with the WebLLM provider. You can also run Ollama or llama.cpp outside the browser.

Model sizes and trade-offs are in the [Model Reference](MODELS.md).

## Apogee cannot read the page

If the popup cannot read the page, or the page holds nothing to summarize:

1. Some pages are off limits to every extension: browser-internal pages (`chrome://`, `about:`, `edge://`), the Chrome Web Store, and Firefox Add-ons. Move to a normal webpage. Nothing is broken.

2. Reload the tab, wait for it to finish loading, then summarize again. The most common cause of an empty result is Apogee reading the page before it finished rendering.

3. For YouTube, check the video has captions. Apogee reads the transcript, not the audio.

4. For a PDF that fails to load, download the file. Open it from disk (a `file://` URL) with file access turned on for the extension. If the PDF holds no text layer (a scan or image export), Apogee cannot read it. Run it through an OCR tool first.

5. For a blank tab, an empty inbox view, or a page drawn fully in images or canvas, expect no text. Open a real article, email, or video instead.

## Still stuck

1. Turn on debug logs in Settings.

2. Reproduce the failure.

3. Use Copy diagnostics in the popup. That copies the browser, provider, model, WebGPU state, and recent log lines. It also copies the raw base error. The raw error is often more exact than the message shown in the popup.

4. Paste that block into your bug report.
