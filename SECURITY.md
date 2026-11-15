# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security or privacy vulnerabilities.**

Report it privately. Either channel works:

- Use GitHub [private vulnerability reporting](https://github.com/darshi1337/apogee/security/advisories/new) (Security tab, then "Report a vulnerability"). We prefer this channel.

- Send email to annupamp1337@gmail.com.

One person maintains Apogee in spare time. Expect a first reply within about one week, not within hours. You will get an acknowledgement. We will assess whether it is reproducible. We will give a fix timeline.

If you want credit in the release notes and the advisory, say so. Tell me the name to use.

## What Counts

For local generation, page content, summaries, and answers stay on your device, including your own Ollama or llama.cpp server over loopback. Documented network features appear in `PRIVACY.md`: model weights, site transcripts, subtitles, threads, the SponsorBlock hash-prefix lookup, and opt-in remote catalogs and generation. Catalog and generation consent are separate. B2 remote generation requires an explicit user generation action and sends input text (including selected, pasted, or extracted uploaded content), title/URL, questions, and instructions to the selected fixed provider origin. Map/reduce and language handling may make multiple calls. Credentials are read only through the worker credential helper, never public settings or caller payloads. Each transmission checks authorization; revocation prevents future sends and aborts active requests, but cannot recall data already sent. Provider and upstream model policies apply.

Remote providers never participate in automatic selection or fallback. Background/context-menu and selected-tab summaries need their own default-off consent and a user start. Sending summary text for follow-up questions needs separate default-off consent. OpenRouter requires fresh free-only catalog eligibility and `allow_fallbacks: false`; OpenCode Console / Go permits paid credits/Go models and excludes free models from the client preset. Firefox requires optional `authenticationInfo`, `websiteContent`, `browsingActivity`, and `personalCommunications` data permissions, requested from a generation consent gesture, before remote generation.

Anything that breaks that claim is a vulnerability here. This holds even if an ordinary extension does not treat it as one. Examples:

- Page content, extracted text, or a generated summary reaches a host other than a documented host. Documented hosts are `127.0.0.1`, `localhost`, and `[::1]` for local inference. They also include Hugging Face, YouTube, Bilibili, Bluesky, SponsorBlock, `openrouter.ai`, and `opencode.ai` as described in `PRIVACY.md`.

- A web page reads data that belongs to another page through the extension. It also reaches extension-privileged APIs.

- An attacker bypasses extension sender checks to invoke background actions from untrusted web pages. Checks include `sender.id`, tab-origin validation, and port-sender validation.

- An attacker pollutes DOM global scope objects or exploits content script execution contexts.

- Something other than the extension reads cached summaries or extracted content. Content persists for a URL that [`isSensitiveUrl`](apogee-extension/lib/storage/pageCache.js) should exclude.

- Prompt injection from page content escapes the grounding rules. It makes the model exfiltrate data or act outside summarizing. Injection that only produces a wrong or silly summary is a bug. It is not a vulnerability.

- Anything lets an attacker widen extension permissions or host access.

Please **do** report a mismatch between what the docs promise and what the code does. Report it even if nothing is exploitable yet. The manifest, the README Privacy section, `PRIVACY.md`, and `docs/STORE-LISTING.md` must describe the same permission set. Drift between them is exactly the type of issue that turns into a real problem later.

## What Does Not Count

- Vulnerabilities in model _output_. A local model produces wrong, offensive, or hallucinated text. That is a quality issue. It is not a security issue.

- An attack needs local access first. It needs your machine, your browser profile, or your unlocked extension storage.

- Reports against how you configured your own Ollama instance. The extension does not control that configuration.

- Automated scanner output has no working proof of concept.

## Accepted Risks

- **`image-size` HIGH advisories in dev tooling (`GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`).** The vulnerable ICNS, JXL, and HEIF parsers reach us only through `web-ext` → `addons-linter`. That chain pins `image-size@2.0.2` exactly. No fixed upstream release exists. The upstream maintainer archived the repo (June 2026). It will not publish a fix from GitHub. Watch for a revival published to npm. Watch also for `addons-linter` dropping the dependency. Exploiting it needs a malicious image inside this repo. That already means commit access. It affects only the machine that runs the linter. The shipped extension never bundles it (`npm audit --omit=dev` is clean). We accept this risk until one of those events happens. Re-check on every dependency bump.

- **`node-forge` HIGH advisory in dev tooling (`GHSA-86w9-cpqp-85rv`, `CVE-2026-85393`).** The RSA PKCS#1 v1.5 verification flaw reaches us only through `web-ext` → `@devicefarmer/adbkit` → `node-forge@1.4.0`. No fixed upstream release exists: 1.4.0 is the latest published version and is still in the vulnerable range. Watch for a patched release, and for `adbkit` moving off `node-forge`. Exploiting it needs a malicious ADB payload against a local dev machine running `web-ext`. That machine already runs arbitrary local tooling. The shipped extension never bundles it (`npm audit --omit=dev` is clean). We accept this risk until a patched release exists. Re-check on every dependency bump.

## Supported Versions

Only the latest released version gets fixes. Apogee ships through the Chrome Web Store and Firefox Add-ons. Both stores auto-update. "Upgrade to the current version" is the remedy for reports against an older version.

Background/context-menu and selected-tab summaries require an additional default-off provider consent and an explicit user start. Sending generated summary text for follow-up questions requires a separate default-off suggestions consent. Automatic suggestions follow only a newly requested summary; restoring a summary never starts remote generation. Remote providers never enter automatic selection or fallback.
