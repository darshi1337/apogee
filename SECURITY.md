# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for a security or privacy vulnerability.**

Report it privately, either way works:

- GitHub's [private vulnerability reporting](https://github.com/darshi1337/apogee/security/advisories/new) (Security tab, then "Report a vulnerability"), which is preferred
- Email annupamp1337@gmail.com

Apogee is maintained by one person in their spare time, so please expect a first reply within about a week rather than within hours. You'll get an acknowledgement, an assessment of whether it's reproducible, and a fix timeline. If you want credit in the release notes and the advisory, say so and tell me how you'd like to be named.

## What counts

Apogee's central claim is that page content, summaries, and answers never leave your device, except to your own Ollama or llama.cpp server over loopback, plus the documented fetches listed in `PRIVACY.md` (model weights, site transcripts/subtitles/threads, and the SponsorBlock hash-prefix lookup). Anything that breaks that claim is a vulnerability here, even if it wouldn't be one in an ordinary extension. For example:

- Page content, extracted text, or a generated summary reaching any host other than the documented ones (`127.0.0.1` / `localhost` for local inference; Hugging Face, YouTube, Bilibili, Bluesky, and SponsorBlock endpoints as described in `PRIVACY.md`)
- A web page reading data belonging to another page through the extension, or reaching extension-privileged APIs
- Bypassing extension sender context validation (`sender.id === chrome.runtime.id`) to invoke background actions from untrusted web pages
- Polluting DOM global scope objects or exploiting content script execution contexts
- Cached summaries or extracted content being readable by something other than the extension, or persisting for a URL that [`isSensitiveUrl`](apogee-extension/lib/storage/pageCache.js) should have excluded
- Prompt injection from page content that escapes the grounding rules to make the model exfiltrate data or act outside summarizing (injection that merely produces a wrong or silly summary is a bug, not a vulnerability)
- Anything letting an attacker widen the extension's permissions or host access

Please **do** report a mismatch between what the docs promise and what the code does, even if nothing is exploitable yet. The manifest, the README's Privacy section, `PRIVACY.md`, and `STORE-LISTING.md` are supposed to describe the same permission set, and a drift between them is exactly the kind of thing that turns into a real problem later.

## What doesn't

- Vulnerabilities in a model's _output_: a local model producing wrong, offensive, or hallucinated text is a quality issue, not a security one
- Anything requiring the attacker to already have local access to your machine, your browser profile, or your unlocked extension storage
- Reports against your own Ollama instance's configuration, which is outside what this extension controls
- Automated scanner output with no working proof of concept

## Accepted risks

- **`image-size` HIGH advisories in dev tooling (`GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`).** The vulnerable ICNS/JXL/HEIF parsers reach us only through `web-ext` → `addons-linter`, which pins `image-size@2.0.2` exactly, and no fixed upstream release exists. Exploiting it needs a malicious image inside this repo, which already means commit access, and only affects the machine running the linter; the shipped extension never bundles it (`npm audit --omit=dev` is clean). Accepted until upstream ships a fix; re-check on every dependency bump.

## Supported versions

Only the latest released version gets fixes. Apogee ships through the Chrome Web Store and Firefox Add-ons, which auto-update, so "upgrade to the current version" is the remedy for anything reported against an older one.
