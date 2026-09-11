# Error messages

This file lists each message Apogee can show you. It states what each message means. It states what to do about it. Rows group by pipeline stage.

You do not have to find your message by hand. Each failure the popup shows carries a "What does this mean?" link. The link opens this file at the right part. Clicking a failure note opens it too. Note bodies end with "Click to see what this means."

Read this first:

- Any error missing here maps onto a generic fallback (for example "An unexpected error occurred. Try summarizing again."). Apogee never shows the raw text word for word. Apogee still logs the original message to the console. It keeps it in the diagnostics buffer. It appears in bug reports when you use Copy diagnostics.

## Reading the page

| Error message | Meaning | What to do |
| --- | --- | --- |
| Apogee can't read this page. Browser-internal pages aren't accessible to extensions, try a regular webpage instead. | The tab is not an http, https, or file URL. Extensions cannot run on chrome://, about:, edge://, devtools://, or view-source: pages. | Nothing to fix. Move to a normal webpage. |
| Apogee can't read the Chrome Web Store. Browsers block extensions from running on this page, try a regular webpage instead. | The tab is on a domain the browser hard-blocks for extensions: the Chrome Web Store, Firefox Add-ons, or Firefox Accounts. The label names whichever one you are on. | Nothing to fix. No extension can read these pages. Copy the text you want into a normal page, or use selection summarize on a different tab. |
| Apogee can't read this page. The browser blocks extensions from running here, try a regular webpage instead. | The browser refused script injection on a page outside the known blocklist. Often the cause is an enterprise policy block, another built-in gallery, or a PDF viewer owned by another add-on. | Check if the site sits on a managed-policy blocklist. If it is a normal site, this is worth reporting with the URL. |
| Apogee couldn't read this page. | Injection failed and the browser gave no reason at all. | Reload the tab and try again. If it repeats on one site, report it. |
| Couldn't read this page. Try reloading it, or pick a different tab. | Extraction ran but came back empty. Most often the page finished rendering after Apogee looked at it. | Reload the page. Wait for it to settle. Then summarize again. |
| Nothing to summarize here yet - open a page, email, or video first. | Extraction worked but found no body text. The page may be a blank tab or an empty inbox view. It may use only canvas or images. The video may lack a transcript. | Open a real article, email, or video, or give text or file content in the popup. For YouTube, check the video has captions. Apogee reads the transcript, not the audio. |
| Could not extract enough page content to answer. | Ask mode could not gather enough text to build a prompt. | Summarize the page first. Then ask your question from the summary view. |
| No answer came back - try rephrasing the question. | The model returned an empty response. Small models do this on vague or very long questions. | Rephrase in a more concrete way. You can also switch to a larger model in Settings. |

## PDFs

| Error message | Meaning | What to do |
| --- | --- | --- |
| Could not download PDF. | Apogee re-fetches the PDF to read its bytes, and the fetch returned nothing. This happens often with PDFs behind a session cookie or a one-time link. | Download the file and open it from disk (a file:// URL). Turn file access on for the extension. |
| Failed to download PDF: 404 | The re-fetch returned an HTTP error. The number is the status the server sent. | Reload the PDF in the tab first. If the link expired, save the file locally and open it from there. |
| This file is not a valid PDF. | pdf.js rejected the bytes. The file is corrupt, or the URL served an HTML error page instead of a PDF. | Open the URL straight to see what it actually serves. Re-download if it is cut off. |
| This PDF is password-protected. | The document needs a password to open, and Apogee does not ask for one. | Remove the password (save an unlocked copy from your PDF viewer). Then summarize that. |
| Couldn't pull any text out of this PDF - it might be a scanned image. | The PDF parsed cleanly but holds no text layer, so it is a scan or an image export. Apogee does no OCR. | Run the file through an OCR tool first. Then summarize the OCR copy. |

## Local files

| Error message | Meaning | What to do |
| --- | --- | --- |
| This file is not a valid DOCX archive. / This is not a valid Word DOCX file. | The picked file is not a readable Office Open XML document. | Re-save it as `.docx`. You can also export it as PDF or plain text. |
| This DOCX file is corrupt. | The ZIP structure or needed document entry is incomplete. | Re-download or re-save the document. Then try again. |
| This DOCX file is password-protected. | Apogee cannot read encrypted Word archives without a password. | Remove the password. Then pick the unlocked copy. |
| This DOCX file contains no readable text. | The document has no text paragraphs Apogee can pull out. | Export the document as PDF with a text layer. You can also copy its text into the popup. |
| This DOCX uses an unsupported compression method. | The archive uses a ZIP compression type the browser does not support. | Re-save the document with Word or LibreOffice. Then try again. |

## Local Ollama

| Error message | Meaning | What to do |
| --- | --- | --- |
| Could not connect to Ollama at http://localhost:11434. Is it running and listening on that address? Error: ... | Apogee could not reach the Ollama server. Either it is not running or it uses a different port. | Run `ollama serve`. Check that the host in Settings matches. Make sure the extension is up to date. You need no `OLLAMA_ORIGINS` setup. The [Local Ollama Guide](OLLAMA.md) covers the CORS handling. |
| Ollama returned an error for model 'llama3.2': ... | Ollama answered but rejected the request. Almost always the pull never happened, or the prompt runs past the model context window. | Run `ollama pull <model>`. You can also pick a model with a larger context window in Settings. `ollama list` shows what you actually have. |
| Ollama sent a malformed response for model 'llama3.2': ... | A line in the streamed response was not valid JSON. Often a proxy sits between Apogee and Ollama and rewrites it. | Point Apogee straight at Ollama with no proxy between. |
| Apogee can only reach Ollama over http on 127.0.0.1 or localhost. Check the host in Settings. | The host typed into Settings was not parseable. It used a scheme other than http, or pointed somewhere outside localhost and 127.0.0.1. Apogee refuses remote Ollama servers on purpose, so page text never leaves the machine. | Enter a full `http://` URL pointing at localhost or 127.0.0.1, for example `http://localhost:11434`. For a remote server, forward the port instead (`ssh -L 11434:localhost:11434 ...`) and point Apogee at localhost. |

## Local llama.cpp

| Error message | Meaning | What to do |
| --- | --- | --- |
| Could not connect to llama.cpp at http://127.0.0.1:8080. Is llama-server running and listening on that address? Error: ... | Apogee could not reach `llama-server`. Either it is not running, or it listens on a different port. | Start it (`llama-server -m <model>.gguf --port 8080`). Check that the URL in Settings matches. `curl http://127.0.0.1:8080/health` returns `{"status":"ok"}` for a live server. Unlike Ollama, it needs no CORS setting. |
| llama.cpp rejected the API key. Check the key in Settings against the --api-key llama-server was started with. | Someone started the server with `--api-key`. Settings holds a missing or wrong key. | Put the same value in the API key field under Settings. You can also restart the server without `--api-key`. |
| llama.cpp failed while handling the request for model '...'. Check the llama-server console for details. | The server returned a 500. Its own message is often an internal parser dump. It stays hidden here. | Look at the terminal running `llama-server` for the real cause. |
| llama.cpp returned an error for model '...': ... | The server rejected the request and said why, for example a prompt past the context window. | Follow the server message. For a context overflow, restart with a larger `-c`. |
| llama.cpp sent a malformed response for model '...': ... | An event in the streamed response was not valid JSON. Often a proxy sits between Apogee and the server and rewrites it. | Point Apogee straight at `llama-server` with no proxy between. |
| Apogee can only reach llama.cpp over http on 127.0.0.1 or localhost. Check the host in Settings. | The URL typed into Settings was not parseable. It used a scheme other than http, or pointed somewhere outside localhost and 127.0.0.1. Apogee refuses remote servers on purpose, so page text never leaves the machine. | Enter a full `http://` URL pointing at localhost or 127.0.0.1, for example `http://127.0.0.1:8080`. For a remote server, forward the port instead (`ssh -L 8080:localhost:8080 ...`) and point Apogee at localhost. |
| Connected, but the model could not be read. Check the API key. | This appears under the model field, not as a failure. `/health` answered but `/v1/models` refused. A wrong API key looks exactly like this, since `/health` stays public. | Check the API key in Settings against the server `--api-key` value. |
| Connected, but the server did not report a model name. | `/v1/models` answered without a usable id. | Type the model name into the field. Apogee sends what you type as-is and never overwrites it. |

## In-browser models

| Error message | Meaning | What to do |
| --- | --- | --- |
| WebGPU is not supported in this browser. Use Local Ollama mode in Settings, or switch to Chrome/Edge. | A banner, not an error. WebLLM needs WebGPU and this browser or GPU driver does not offer it. | Switch to the In-Browser (Transformers.js) provider, which runs on WASM, or to Local Ollama. On Chrome, updating the GPU driver sometimes brings back WebGPU. |
| In-browser AI (WebLLM) needs Chrome's offscreen API, which this browser doesn't support. Use the In-Browser (Transformers.js) or Local Ollama provider in Settings instead. | Firefox and other non-Chromium browsers have no offscreen documents, so the WebLLM path cannot start at all. | Pick one of the two providers named in the message. |
| The model download keeps getting interrupted (the download server stalled or the connection dropped). Progress so far is saved, so trying again later will resume where it left off. | Four download tries failed partway. Downloaded parts stay cached. | Wait and retry. It resumes instead of restarting. A VPN, a captive portal, or a strict proxy is the common cause. |
| Failed to load bundled ONNX wasm (404) | The installed extension lacks the Transformers.js runtime files, so the build is incomplete or the install is broken. | Reinstall the extension. If you loaded it unpacked, rebuild with `npm run build` and reload it. |
| Highlight-in-page needs the offscreen document (Chrome/Edge only). | Click-to-locate matches summary sentences against the page with embeddings made in the offscreen document, which non-Chromium browsers do not have. | Nothing to fix. The feature is Chromium-only. The rest of the summary works normally. |
| (couldn't locate this passage on the page) | Apogee adds it to a summary line you clicked. The matcher could not find a confident source passage, often because the line joins several parts of the page. | Nothing to fix. Use the browser own find-in-page for that wording. |
| Memory limit reached while processing this document. Try a smaller model or reducing context size. | The document or transcript passed WebGPU/WASM memory limits or buffer bounds. | Pick a smaller model in Settings. You can also summarize a shorter document or part. |
| Error: ... | It appears in the model progress bar when the in-browser engine fails mid-load or mid-generation. The text after the colon is the base failure. | Read the base text. If it mentions memory or a lost device, pick a smaller model in Settings. |

## Streaming, cancelling, and background jobs

| Error message | Meaning | What to do |
| --- | --- | --- |
| Connection to the model was lost before the response finished. | The message port closed mid-stream. Almost always the MV3 service worker shuts down partway through a long generation. | Summarize again. Keeping the popup open, or using a smaller or faster model, makes it less likely. |
| Connection to local model was lost | The browser tore down the offscreen document while WebLLM generated. | Summarize again. |
| This response is no longer available (its stream expired). Try summarizing again. | The popup reopened and asked to resume a job with dropped buffered output. The summary text itself disappeared. | Summarize again. A cached page returns the result at once. |
| Generation was cancelled. | Ollama dropped the request from its side. Popup cancellation takes another path and shows no error. So this message means the server dropped the request. | Check if Ollama restarted or ran out of memory. Then try again. |
| Unknown error during streaming | The stream reported a failure with no detail tied to it. | Turn on debug logs in Settings. Reproduce the failure. Then use Copy diagnostics. The raw cause is often in the log. |
| Something went wrong summarizing this page. (notification, titled "Summarize failed") | This is fallback text for the desktop note. It appears when a context-menu or keyboard-shortcut job failed without a usable message. | Open the popup. Summarize again there. The popup shows the exact error. |

## Settings, cache, and diagnostics

| Error message | Meaning | What to do |
| --- | --- | --- |
| No models found on this Ollama instance, pull one with `ollama pull <model>`. | Apogee reached Ollama, but it has no models installed. | Run `ollama pull llama3.2` (or any model you prefer). Then reopen Settings. |
| Showing default models, connect to Ollama to see yours. | Apogee could not reach Ollama, so the model dropdown lists built-in defaults instead of what you actually have. | Start Ollama and check the host in Settings. The list refreshes when the link works. |
| Disconnected | The link light could not reach the picked provider. | For Ollama, check the server and host. For in-browser providers, this clears once the model ends loading. |
| Error clearing cached data: ... | It appears next to Clear cached data when clearing storage fails. | Retry. If it stays, clear the extension storage from the browser extension settings. |
| Error fetching logs: ... | The background script would not release the debug log. Often the service worker sleeps or restarts at that moment. | Reopen the popup and try again. |
| Error clearing logs: ... | The cause matches the read failure. It happens on the clear action. | Reopen the popup and try again. |
| No logs recorded. Try starting summary or chat. | Debug logging is on, but it caught nothing yet. | Run a summary or an ask first. Then reopen the log panel. |
| Copy failed | The browser refused the clipboard write, often because the popup lost focus mid-copy. | Click inside the popup and copy again. |

## Notices that are not errors

These read like warnings but nothing has gone wrong.

| Message | Meaning |
| --- | --- |
| Long page - summarizing the key parts. | The page passed the model context window, so Apogee summarized it in chunks and joined the results step by step. |
| Summarizing part 2 of 5... | Progress through the map pass (one entry per chunk). |
| Merging summary... | The final reduce that joins per-chunk notes (middle tree-reduces report `Merging 1/3...` before the final). |
| Translating... / Translating 3/8... | The summary changes into the output language picked in Settings. |
| This summary isn't in the page's original language. Re-summarize to apply. | The output-language setting changed after Apogee made this summary. |
| Download hiccup - retrying (attempt 2 of 4)... | A model download stalled and retries on its own. Take no action unless all four tries fail. |
| Reconnecting to local model... | The browser tore it down and remakes the offscreen document. |

## Internal

These should never reach the UI. If one does, it is a bug worth reporting with the steps that made it.

| Error message | Meaning |
| --- | --- |
| No streamId returned from service worker | The background script took a job but handed back no stream handle. |
| Unknown ollama-stream action: ... | A message arrived on the Ollama stream port with an action the handler does not know. |
| Unknown transformers-stream action: ... | The same, on the Transformers.js stream port. |
| Unknown action: ... | An unknown message reached the service worker or the offscreen document dispatcher. |
| Unknown Transformers.js model: ... | Someone asked for a model id missing from the registry, often after a settings value lives past a version downgrade. |

## Reporting one

If your symptom matches a known failure, the [Troubleshooting](TROUBLESHOOTING.md) page may fix it faster than a report.

Turn on debug logs in Settings. Reproduce the failure. Then use Copy diagnostics. That copies the browser, provider, model, WebGPU state, and recent log lines. It also copies the raw base error. The raw error is often more exact than the message shown in the popup.
