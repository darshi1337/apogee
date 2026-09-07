# Apogee Browser Support and Compatibility Reference

Apogee comes in two versions: a Chromium version (`dist/chrome`, using Manifest V3 with an offscreen document for WebGPU) and a Firefox version (`dist/firefox`, without the offscreen document). Any browser that works with Chromium will work with this Chromium version.

## Browser Support List

The table below shows which features work, what engine is used, and how well it’s tested in different browsers.

| Browser | WebLLM (AI in Browser, WebGPU) | Transformers.js (AI in Browser, WASM) | Local Ollama | Local llama.cpp | Notes |
|---|---|---|---|---|---|
| Chrome 116+ | Yes, this is the default | Yes, you can turn it on in Settings | Yes | Yes | This is our main target and has been tested a lot. It uses a popup and a side panel to show things. |
| Edge 116+ | Yes, this is the default | Yes, you can turn it on in Settings | Yes | Yes | This browser is based on Chromium, so it works the same way as Chrome and has side panel support. |
| Dia | Yes, this is the default | Yes, you can turn it on in Settings | Yes | Yes | This browser is based on Chromium. |
| Brave | Should work | Should work | Yes | Yes | This browser is based on Chromium. You might need to enable WebGPU in `brave://flags`. We haven't fully tested this. |
| Opera / Opera GX | Should work | Should work | Yes | Yes | This browser is based on Chromium, but we haven’t checked it ourselves. |
| Vivaldi | Should work | Should work | Yes | Yes | This browser is based on Chromium, but we haven’t checked it ourselves. |
| Arc | Should work | Should work | Yes | Yes | This browser is based on Chromium, but we haven’t checked it ourselves. |
| Firefox 140+ | No | Yes, this is the default | Yes | Yes | The Firefox version uses WebExtensions. It needs a newer version of Firefox (at least 140) to work properly. It also needs permission to collect data (`data_collection_permissions`). Older versions won’t install it.  WebLLM needs WebGPU to run outside a normal tab, but Firefox doesn't support this feature. Transformers.js runs directly in the background of Firefox and is the default there because it doesn’t need WebGPU or a worker. |
| Safari | No | No | No | No | Apogee doesn’t have a special version for Safari. We use a different way to build it for Chrome and Firefox.  We haven't tested Safari, even though Safari has WebGPU support. |

Local llama.cpp works the same as Local Ollama everywhere. Both send requests to a server on `127.0.0.1`. They don’t need WebGPU or an offscreen document. See the [Local llama.cpp Guide](LLAMACPP.md) for more information.

PDF, DOCX, and text you copy and paste are handled in the popup window on Chrome and Firefox. The differences between browsers only affect how the AI works and how the side panel appears; reading files locally doesn’t need WebGPU, an offscreen document, or a browser tab.

## Hardware and Compatibility Notes

Check the MDN WebGPU API browser compatibility table for exact versions of WebGPU supported by each browser and operating system. This information changes quickly, so it's the best source of truth. You need a GPU that supports WebGPU (most modern GPUs) to use WebLLM in-browser mode. Local Ollama doesn’t need its own GPU; it just needs whatever Ollama itself needs.
