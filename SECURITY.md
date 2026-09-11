# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security or privacy vulnerabilities.**

Report it privately. Either channel works:

- Use GitHub [private vulnerability reporting](https://github.com/darshi1337/apogee/security/advisories/new) (Security tab, then "Report a vulnerability"). We prefer this channel.

- Send email to annupamp1337@gmail.com.

One person maintains Apogee in spare time. Expect a first reply within about one week, not within hours. You will get an acknowledgement. We will assess whether it is reproducible. We will give a fix timeline.

If you want credit in the release notes and the advisory, say so. Tell me the name to use.

## What Counts

Apogee makes one central claim. Page content, summaries, and answers never leave your device. Two exceptions exist. One is your own Ollama or llama.cpp server over loopback. The other is the documented fetches in `PRIVACY.md` (model weights, site transcripts, subtitles, threads, and the SponsorBlock hash-prefix lookup).

Anything that breaks that claim is a vulnerability here. This holds even if an ordinary extension does not treat it as one. Examples:

- Page content, extracted text, or a generated summary reaches a host other than a documented host. Documented hosts are `127.0.0.1` and `localhost` for local inference. They also include Hugging Face, YouTube, Bilibili, Bluesky, and SponsorBlock endpoints as described in `PRIVACY.md`.

- A web page reads data that belongs to another page through the extension. It also reaches extension-privileged APIs.

- An attacker bypasses extension sender checks to invoke background actions from untrusted web pages. Checks include `sender.id`, tab-origin validation, and port-sender validation.

- An attacker pollutes DOM global scope objects or exploits content script execution contexts.

- Something other than the extension reads cached summaries or extracted content. Content persists for a URL that [`isSensitiveUrl`](apogee-extension/lib/storage/pageCache.js) should exclude.

- Prompt injection from page content escapes the grounding rules. It makes the model exfiltrate data or act outside summarizing. Injection that only produces a wrong or silly summary is a bug. It is not a vulnerability.

- Anything lets an attacker widen extension permissions or host access.

Please **do** report a mismatch between what the docs promise and what the code does. Report it even if nothing is exploitable yet. The manifest, the README Privacy section, `PRIVACY.md`, and `STORE-LISTING.md` must describe the same permission set. Drift between them is exactly the type of issue that turns into a real problem later.

## What Does Not Count

- Vulnerabilities in model _output_. A local model produces wrong, offensive, or hallucinated text. That is a quality issue. It is not a security issue.

- An attack needs local access first. It needs your machine, your browser profile, or your unlocked extension storage.

- Reports against how you configured your own Ollama instance. The extension does not control that configuration.

- Automated scanner output has no working proof of concept.

## Accepted Risks

- **`image-size` HIGH advisories in dev tooling (`GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`).** The vulnerable ICNS, JXL, and HEIF parsers reach us only through `web-ext` → `addons-linter`. That chain pins `image-size@2.0.2` exactly. No fixed upstream release exists. The upstream maintainer archived the repo (June 2026). It will not publish a fix from GitHub. Watch for a revival published to npm. Watch also for `addons-linter` dropping the dependency. Exploiting it needs a malicious image inside this repo. That already means commit access. It affects only the machine that runs the linter. The shipped extension never bundles it (`npm audit --omit=dev` is clean). We accept this risk until one of those events happens. Re-check on every dependency bump.

## Supported Versions

Only the latest released version gets fixes. Apogee ships through the Chrome Web Store and Firefox Add-ons. Both stores auto-update. “Upgrade to the current version” is the remedy for reports against an older version.
