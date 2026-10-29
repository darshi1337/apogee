# Apogee Browser Support and Compatibility Reference

Apogee ships in two builds. The Chromium build is `dist/chrome`. It uses Manifest V3 with an offscreen document for WebGPU. The Firefox build is `dist/firefox`. It has no offscreen document. Any browser based on Chromium works with the Chromium build.

## Browser Support List

The table below shows which features work, which engine each feature uses, and how we tested each browser.

| Browser | WebLLM (AI in Browser, WebGPU) | Transformers.js (AI in Browser, WASM) | Local Ollama | Local llama.cpp | Notes |
| --- | --- | --- | --- | --- | --- |
| Chrome 116+ | Yes. This is the default. | Yes. Turn it on in Settings. | Yes. | Yes. | Main target. Tested heavily. Uses a popup and a side panel. |
| Edge 116+ | Yes. This is the default. | Yes. Turn it on in Settings. | Yes. | Yes. | Based on Chromium. Works the same as Chrome and supports the side panel. |
| Dia | Yes. This is the default. | Yes. Turn it on in Settings. | Yes. | Yes. | Based on Chromium. |
| Brave | Should work. | Should work. | Yes. | Yes. | Based on Chromium. If needed, turn on WebGPU in `brave://flags`. Not fully tested. |
| Opera / Opera GX | Should work. | Should work. | Yes. | Yes. | Based on Chromium. We did not test it ourselves. |
| Vivaldi | Should work. | Should work. | Yes. | Yes. | Based on Chromium. We did not test it ourselves. |
| Arc | Should work. | Should work. | Yes. | Yes. | Based on Chromium. We did not test it ourselves. |
| Firefox 140+ | No. | Yes. This is the default. | Yes. | Yes. | The Firefox build uses WebExtensions. It needs Firefox 140 or later. It also needs permission to collect data (`data_collection_permissions`). Older versions will not install it. WebLLM needs WebGPU outside a normal tab, but Firefox lacks this. Transformers.js runs directly in the Firefox background. It is the default there because it needs no WebGPU and no worker. |
| Safari | No. | No. | No. | No. | Apogee has no Safari build. We build for Chrome and Firefox only. We did not test Safari, even though Safari supports WebGPU. |

Local llama.cpp works the same as Local Ollama in all browsers. Both send requests to a server on `127.0.0.1`. They need no WebGPU and no offscreen document. See the [Local llama.cpp Guide](LLAMACPP.md) for details.

The popup handles PDF, DOCX, and pasted text on Chrome and Firefox. Browser differences affect only the AI engine and the side panel. Local file reading needs no WebGPU, no offscreen document, and no browser tab.

## Hardware and Compatibility Notes

Check the MDN WebGPU API browser compatibility table for exact WebGPU versions by browser and operating system. This information changes fast, so that table is the best source. You need a GPU with WebGPU support (most modern GPUs) for WebLLM in-browser mode. Local Ollama needs no extra GPU. It needs only what Ollama itself needs.
