# Apogee Browser Support and Compatibility Reference

Apogee comes in two versions. The Chromium version is `dist/chrome`. It uses Manifest V3 with an offscreen document for WebGPU. The Firefox version is `dist/firefox`. It has no offscreen document. Any browser that works with Chromium works with this Chromium version.

## Browser Support List

The table below shows which features work, which engine each feature uses, and how well we tested each browser.

| Browser | WebLLM (AI in Browser, WebGPU) | Transformers.js (AI in Browser, WASM) | Local Ollama | Local llama.cpp | Notes |
|---|---|---|---|---|---|
| Chrome 116+ | Yes. This is the default. | Yes. Turn it on in Settings. | Yes. | Yes. | This is our main target. We tested it a lot. It uses a popup and a side panel to show things. |
| Edge 116+ | Yes. This is the default. | Yes. Turn it on in Settings. | Yes. | Yes. | Chromium is the base for this browser. It works the same way as Chrome and has side panel support. |
| Dia | Yes. This is the default. | Yes. Turn it on in Settings. | Yes. | Yes. | Chromium is the base for this browser. |
| Brave | Should work. | Should work. | Yes. | Yes. | Chromium is the base for this browser. If needed, enable WebGPU in `brave://flags`. We did not fully test it. |
| Opera / Opera GX | Should work. | Should work. | Yes. | Yes. | Chromium is the base for this browser. We did not check it ourselves. |
| Vivaldi | Should work. | Should work. | Yes. | Yes. | Chromium is the base for this browser. We did not check it ourselves. |
| Arc | Should work. | Should work. | Yes. | Yes. | Chromium is the base for this browser. We did not check it ourselves. |
| Firefox 140+ | No. | Yes. This is the default. | Yes. | Yes. | The Firefox version uses WebExtensions. It needs a newer version of Firefox (at least 140) to work properly. It also needs permission to collect data (`data_collection_permissions`). Older versions will not install it. WebLLM needs WebGPU to run outside a normal tab, but Firefox does not support this feature. Transformers.js runs directly in the background of Firefox. It is the default there because it does not need WebGPU or a worker. |
| Safari | No. | No. | No. | No. | Apogee has no special version for Safari. We build it a different way for Chrome and Firefox. We did not test Safari, even though Safari has WebGPU support. |

Local llama.cpp works the same as Local Ollama everywhere. Both send requests to a server on `127.0.0.1`. They do not need WebGPU or an offscreen document. See the [Local llama.cpp Guide](LLAMACPP.md) for more information.

The popup window handles PDF, DOCX, and pasted text on Chrome and Firefox. Browser differences affect only how the AI works and how the side panel appears. Reading files locally does not need WebGPU, an offscreen document, or a browser tab.

## Hardware and Compatibility Notes

Check the MDN WebGPU API browser compatibility table for exact versions of WebGPU supported by each browser and operating system. This information changes quickly, so it is the best source of truth. You need a GPU that supports WebGPU (most modern GPUs) to use WebLLM in-browser mode. Local Ollama does not need its own GPU. It needs only what Ollama itself needs.
