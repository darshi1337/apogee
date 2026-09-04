# Error messages

Each message Apogee can show you, what it means, and what to do about it. Grouped by where in the pipeline it comes from.

You do not have to find your message by hand. Each failure the popup shows carries a "What does this mean?" link that opens this file at the right part, and clicking a failure note opens it too. Note bodies end with "Click to see what this means."

One more thing worth knowing before reading the tables:

- Any error not listed here is mapped onto a generic fallback (for example "An unexpected error occurred. Try summarizing again.") instead of being shown word for word. The original message is still logged to the console and kept in the diagnostics buffer, so it appears in bug reports when you use Copy diagnostics.

## Reading the page

| Error message | Meaning | What to do |
| --- | --- | --- |
| Apogee can't read this page. Browser-internal pages aren't accessible to extensions, try a regular webpage instead. | The tab is not an http, https, or file URL. Extensions cannot run on chrome://, about:, edge://, devtools://, or view-source: pages. | Nothing to fix. Move to a normal webpage. |
| Apogee can't read the Chrome Web Store. Browsers block extensions from running on this page, try a regular webpage instead. | The tab is on a domain the browser hard-blocks for extensions: the Chrome Web Store, Firefox Add-ons, or Firefox Accounts. The label names whichever one you are on. | Nothing to fix. No extension can read these pages. Copy the text you want into a normal page, or use selection summarize on a different tab. |
| Apogee can't read this page. The browser blocks extensions from running here, try a regular webpage instead. | Script injection was refused on a page outside the known blocklist. Often an enterprise policy block, another built-in gallery, or a PDF viewer owned by another add-on. | Check if the site sits on a managed-policy blocklist. If it is a normal site, this is worth reporting with the URL. |
| Apogee couldn't read this page. | Injection failed and the browser gave no reason at all. | Reload the tab and try again. If it repeats on one site, report it. |
| Couldn't read this page. Try reloading it, or pick a different tab. | Extraction ran but came back empty. Most often the page finished rendering after Apogee looked at it. | Reload the page, wait for it to settle, then summarize again. |
| Nothing to summarize here yet - open a page, email, or video first. | Extraction worked but found no body text: a blank tab, an empty inbox view, a page drawn fully in canvas or images, or a video with no transcript. | Open a real article, email, or video, or give text or file content in the popup. For YouTube, check the video has captions. Apogee reads the transcript, not the audio. |
| Could not extract enough page content to answer. | Ask mode could not gather enough text to build a prompt. | Summarize the page first, then ask your question from the summary view. |
| No answer came back - try rephrasing the question. | The model returned an empty response. Small models do this on vague or very long questions. | Rephrase in a more concrete way, or switch to a larger model in Settings. |

## PDFs

| Error message | Meaning | What to do |
| --- | --- | --- |
| Could not download PDF. | Apogee re-fetches the PDF to read its bytes, and the fetch returned nothing. Common with PDFs behind a session cookie or a one-time link. | Download the file and open it from disk (a file:// URL), with file access on for the extension. |
| Failed to download PDF: 404 | The re-fetch returned an HTTP error. The number is the status the server sent. | Reload the PDF in the tab first. If the link has expired, save the file locally and open it from there. |
| This file is not a valid PDF. | pdf.js rejected the bytes. The file is corrupt, or the URL served an HTML error page instead of a PDF. | Open the URL straight to see what it actually serves. Re-download if it is cut off. |
| This PDF is password-protected. | The document needs a password to open, and Apogee does not ask for one. | Remove the password (save an unlocked copy from your PDF viewer) and summarize that. |
| Couldn't pull any text out of this PDF - it might be a scanned image. | The PDF parsed cleanly but holds no text layer, so it is a scan or an image export. Apogee does no OCR. | Run the file through an OCR tool first, then summarize the OCR copy. |

## Local files

| Error message | Meaning | What to do |
| --- | --- | --- |
| This file is not a valid DOCX archive. / This is not a valid Word DOCX file. | The picked file is not a readable Office Open XML document. | Re-save it as `.docx`, or export it as PDF or plain text. |
| This DOCX file is corrupt. | The ZIP structure or needed document entry is incomplete. | Re-download or re-save the document and try again. |
| This DOCX file is password-protected. | Encrypted Word archives cannot be read without a password. | Remove the password and pick the unlocked copy. |
| This DOCX file contains no readable text. | The document has no text paragraphs Apogee can pull out. | Export the document as PDF with a text layer or copy its text into the popup. |
| This DOCX uses an unsupported compression method. | The archive uses a ZIP compression type not supported by the browser. | Re-save the document with Word or LibreOffice and try again. |

## Local Ollama

| Error message | Meaning | What to do |
| --- | --- | --- |
| Could not connect to Ollama at http://localhost:11434. Is it running and listening on that address? Error: ... | Apogee could not reach the Ollama server. Either it is not running or it uses a different port. | Run `ollama serve`, check the host in Settings matches, and make sure the extension is up to date. No `OLLAMA_ORIGINS` setup is needed. The CORS handling is covered in the [Local Ollama Guide](OLLAMA.md). |
| Ollama returned an error for model 'llama3.2': ... | Ollama answered but rejected the request. Almost always the model is not pulled, or the prompt runs past the model context window. | Run `ollama pull <model>`, or pick a model with a larger context window in Settings. `ollama list` shows what you actually have. |
| Ollama sent a malformed response for model 'llama3.2': ... | A line in the streamed response was not valid JSON, often because a proxy sits between Apogee and Ollama and rewrites it. | Point Apogee straight at Ollama with no proxy between. |
| Apogee can only reach Ollama over http on 127.0.0.1 or localhost. Check the host in Settings. | The host typed into Settings was not parseable, used a scheme other than http, or pointed somewhere outside localhost/127.0.0.1. Remote Ollama servers are refused on purpose so page text never leaves the machine. | Enter a full `http://` URL pointing at localhost or 127.0.0.1, for example `http://localhost:11434`. For a remote server, forward the port instead (`ssh -L 11434:localhost:11434 ...`) and point Apogee at localhost. |

## Local llama.cpp

| Error message | Meaning | What to do |
| --- | --- | --- |
| Could not connect to llama.cpp at http://127.0.0.1:8080. Is llama-server running and listening on that address? Error: ... | Apogee could not reach `llama-server`. Either it is not running, or it listens on a different port. | Start it (`llama-server -m <model>.gguf --port 8080`) and check the URL in Settings matches. `curl http://127.0.0.1:8080/health` should return `{"status":"ok"}`. Unlike Ollama there is no CORS setting to set. |
| llama.cpp rejected the API key. Check the key in Settings against the --api-key llama-server was started with. | The server was started with `--api-key` and the key in Settings is missing or does not match. | Put the same value in the API key field under Settings, or restart the server without `--api-key`. |
| llama.cpp failed while handling the request for model '...'. Check the llama-server console for details. | The server returned a 500. Its own message is often an internal parser dump, so it is not shown here. | Look at the terminal running `llama-server` for the real cause. |
| llama.cpp returned an error for model '...': ... | The server rejected the request and said why, for example a prompt past the context window. | Follow the server message. For a context overflow, restart with a larger `-c`. |
| llama.cpp sent a malformed response for model '...': ... | An event in the streamed response was not valid JSON, often because a proxy sits between Apogee and the server and rewrites it. | Point Apogee straight at `llama-server` with no proxy between. |
| Apogee can only reach llama.cpp over http on 127.0.0.1 or localhost. Check the host in Settings. | The URL typed into Settings was not parseable, used a scheme other than http, or pointed somewhere outside localhost/127.0.0.1. Remote servers are refused on purpose so page text never leaves the machine. | Enter a full `http://` URL pointing at localhost or 127.0.0.1, for example `http://127.0.0.1:8080`. For a remote server, forward the port instead (`ssh -L 8080:localhost:8080 ...`) and point Apogee at localhost. |
| Connected, but the model could not be read. Check the API key. | Shown under the model field, not as a failure. `/health` answered but `/v1/models` refused, which is what a wrong API key looks like since `/health` stays public. | Check the API key in Settings against the one the server was started with. |
| Connected, but the server did not report a model name. | `/v1/models` answered without a usable id. | Type the model name into the field. What you type is sent as-is and is not overwritten. |

## In-browser models

| Error message | Meaning | What to do |
| --- | --- | --- |
| WebGPU is not supported in this browser. Use Local Ollama mode in Settings, or switch to Chrome/Edge. | A banner, not an error. WebLLM needs WebGPU and this browser or GPU driver does not offer it. | Switch to the In-Browser (Transformers.js) provider, which runs on WASM, or to Local Ollama. On Chrome, updating the GPU driver sometimes brings back WebGPU. |
| In-browser AI (WebLLM) needs Chrome's offscreen API, which this browser doesn't support. Use the In-Browser (Transformers.js) or Local Ollama provider in Settings instead. | Firefox and other non-Chromium browsers have no offscreen documents, so the WebLLM path cannot start at all. | Pick one of the two providers named in the message. |
| The model download keeps getting interrupted (the download server stalled or the connection dropped). Progress so far is saved, so trying again later will resume where it left off. | Four download tries failed partway. Already-downloaded parts are cached. | Wait and retry. It resumes instead of restarting. A VPN, a captive portal, or a strict proxy is the common cause. |
| Failed to load bundled ONNX wasm (404) | The Transformers.js runtime files are missing from the installed extension, so the build is incomplete or the install is broken. | Reinstall the extension. If you loaded it unpacked, rebuild with `npm run build` and reload it. |
| Highlight-in-page needs the offscreen document (Chrome/Edge only). | Click-to-locate matches summary sentences against the page with embeddings made in the offscreen document, which non-Chromium browsers do not have. | Nothing to fix. The feature is Chromium-only. The rest of the summary works normally. |
| (couldn't locate this passage on the page) | Added to a summary line you clicked. The matcher could not find a confident source passage, often because the line joins several parts of the page. | Nothing to fix. Use the browser own find-in-page for that wording. |
| Memory limit reached while processing this document. Try a smaller model or reducing context size. | The document or transcript passed WebGPU/WASM memory limits or buffer bounds. | Pick a smaller model in Settings, or summarize a shorter document or part. |
| Error: ... | Shown in the model progress bar when the in-browser engine fails mid-load or mid-generation. The text after the colon is the base failure. | Read the base text. If it mentions memory or the device being lost, pick a smaller model in Settings. |

## Streaming, cancelling, and background jobs

| Error message | Meaning | What to do |
| --- | --- | --- |
| Connection to the model was lost before the response finished. | The message port closed mid-stream. Almost always the MV3 service worker was shut down partway through a long generation. | Summarize again. Keeping the popup open, or using a smaller or faster model, makes it less likely. |
| Connection to local model was lost | The offscreen document was torn down while WebLLM was generating. | Summarize again. |
| This response is no longer available (its stream expired). Try summarizing again. | The popup reopened and asked to resume a job whose buffered output has been dropped. The summary text itself is gone, not just hidden. | Summarize again. If the page was cached, the result comes back at once. |
| Generation was cancelled. | Ollama dropped the request from its side. Cancelling from the popup is handled apart and shows no error, so seeing this means the server dropped the request. | Check if Ollama restarted or ran out of memory, then try again. |
| Unknown error during streaming | The stream reported a failure with no detail tied to it. | Turn on debug logs in Settings, reproduce, and use Copy diagnostics. The raw cause is often in the log. |
| Something went wrong summarizing this page. (notification, titled "Summarize failed") | Fallback text for the desktop note when a context-menu or keyboard-shortcut job failed without a usable message. | Open the popup and summarize again there. The popup shows the exact error. |

## Settings, cache, and diagnostics

| Error message | Meaning | What to do |
| --- | --- | --- |
| No models found on this Ollama instance, pull one with `ollama pull <model>`. | Apogee reached Ollama, but it has no models installed. | Run `ollama pull llama3.2` (or any model you prefer), then reopen Settings. |
| Showing default models, connect to Ollama to see yours. | Apogee could not reach Ollama, so the model dropdown lists built-in defaults instead of what you actually have. | Start Ollama and check the host in Settings. The list refreshes when the link works. |
| Disconnected | The link light could not reach the picked provider. | For Ollama, check the server and host. For in-browser providers, this clears once the model ends loading. |
| Error clearing cached data: ... | Shown next to Clear cached data when clearing storage failed. | Retry. If it stays, clear the extension storage from the browser extension settings. |
| Error fetching logs: ... | The debug log could not be read from the background script, often because the service worker was asleep or restarting. | Reopen the popup and try again. |
| Error clearing logs: ... | Same cause, on the clear action. | Reopen the popup and try again. |
| No logs recorded. Try starting summary or chat. | Debug logging is on but nothing has been caught yet. | Run a summary or an ask first, then reopen the log panel. |
| Copy failed | The clipboard write was refused, often because the popup lost focus mid-copy. | Click inside the popup and copy again. |

## Notices that are not errors

These read like warnings but nothing has gone wrong.

| Message | Meaning |
| --- | --- |
| Long page - summarizing the key parts. | The page passed the model context window, so Apogee summarized it in chunks and joined the results step by step. |
| Summarizing part 2 of 5... | Progress through the map pass (one entry per chunk). |
| Merging summary... | The final reduce that joins per-chunk notes (middle tree-reduces report `Merging 1/3...` before the final). |
| Translating... / Translating 3/8... | The summary is being changed into the output language picked in Settings. |
| This summary isn't in the page's original language. Re-summarize to apply. | The output-language setting changed after this summary was made. |
| Download hiccup - retrying (attempt 2 of 4)... | A model download stalled and is being tried again on its own. No action needed unless all four tries fail. |
| Reconnecting to local model... | The offscreen document is being remade after the browser tore it down. |

## Internal

These should never reach the UI. If one does, it is a bug worth reporting with the steps that made it.

| Error message | Meaning |
| --- | --- |
| No streamId returned from service worker | The background script took a job but handed back no stream handle. |
| Unknown ollama-stream action: ... | A message arrived on the Ollama stream port with an action the handler does not know. |
| Unknown transformers-stream action: ... | The same, on the Transformers.js stream port. |
| Unknown action: ... | An unknown message reached the service worker or the offscreen document dispatcher. |
| Unknown Transformers.js model: ... | A model id was asked for that is not in the registry, often after a settings value lives past a version downgrade. |

## Reporting one

Turn on debug logs in Settings, reproduce the failure, then use Copy diagnostics. That copies the browser, provider, model, WebGPU state, and recent log lines plus the raw base error, which is often more exact than the message shown in the popup.
