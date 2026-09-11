# Contributing to Apogee

Thanks for looking at Apogee. This project is a single package, `apogee-extension/`, a Chrome/Edge/Dia/Firefox browser extension.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Your first contribution

New here? Start with the [`good first issue`][gfi] list. Each one stays scoped. Finish it without reading the whole extension first. Each one names the files it touches and what "done" means.

What the labels mean:

- **`good first issue`**: self-contained, no deep context needed, an evening of work

- **`help wanted`**: real work we want help with, but it assumes some comfort with the codebase already

- **`extractor`**: adding or fixing per-site page extraction, the most repeatable work here.

  `content/extractors/hackernews.js` and `reddit.js` are two examples to copy from. `thread.js` holds the shared code they both build on.

  The `wikipedia.js` extractor shows how to trim a long page and hand back `null` for unhandled pages. The `bluesky.js` extractor shows API-first extraction with DOM fallback. The `youtube.js` extractor shows transcript extraction with `chrome` message stubbing

Extractor work needs no browser, no GPU, and no model download. Extractors run against saved HTML fixtures in plain Node, so `npm install && npm test` is the full setup. See [`apogee-extension/tests/extractors/README.md`](apogee-extension/tests/extractors/README.md) for the harness and worked examples. If that is the work you want, skip the browser setup below fully.

### Claiming an issue

Comment on it and a maintainer assigns it to you, so two people do not write the same patch. If it sits for seven days with no draft PR and no update, it opens again unassigned. That judges nothing about you. It only keeps a quiet claim from blocking the next person. If you are still on it and need more time, say so on the issue. It stays yours.

One issue per PR, and please do not start on something already assigned to someone else.

If nothing on the list fits, open an issue. Say what you want to change before you write it. This matters mainly for network use or permissions.

Stuck halfway? Open a draft PR and ask. A half-finished branch with a clear question is easier to help with than a stalled one.

[gfi]: https://github.com/darshi1337/apogee/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22

## Getting set up

Use **Node 22 or newer**, which is what CI runs and what `.nvmrc` pins. Older versions differ in ways that show up as test failures which are not your fault.

```bash
cd apogee-extension
npm install
npm run dev     # watch mode, rebuilds dist/chrome and dist/firefox on save
```

Load `apogee-extension/dist/chrome` (or `dist/firefox`) as an unpacked/temporary extension in your browser. See the main [README](README.md#get-started) for the project overview and [BROWSERS.md](BROWSERS.md) for per-browser notes.

If you work on the **Local Ollama** provider, you also need Ollama installed and running. The extension reaches it straight with no `OLLAMA_ORIGINS` setup (see the [Local Ollama Guide](OLLAMA.md)).

## Before opening a PR

Run these from `apogee-extension/`. `lint`, `test`, and `build` also run at the repo root. `format:check` does not.

```bash
npm run format:check   # prettier --check .
npm run lint           # eslint .
npm test               # node --test
npm run build           # builds both dist/chrome and dist/firefox
```

CI runs the same four checks on each push and pull request. A PR cannot merge until they pass. On your first PR to the repo, CI waits for a maintainer to approve the run. A workflow sitting at "pending" for a long time is normal. It means nothing you did wrong.

If `format:check` fails, run `npm run format` to fix it on its own.

**Do not edit `CHANGELOG.md`.** It gains entries at release time, not per PR. If all add their own entry, each open PR conflicts with each other one, and then again after each merge. Describe the change in your PR text instead. The release credits it. A bot rewrites the `[Unreleased]` section from commit subjects after every merge. That is another reason to write the subject as the entry.

### Test fixtures

If your change adds an HTML fixture under `tests/extractors/fixtures/`, trim it to the markup your extractor actually reads. Swap real people details with `alice`/`bob` placeholders, as the current fixtures do. Saved pages carry someone else copyrighted content and often real usernames, avatars, or, in Gmail case, real mail.

A small hand-trimmed fixture is better in all ways. It stays reviewable. It stays stable when the site redesigns parts you dropped. It carries nobody personal data.

## Code style

- No comments explaining _what_ code does. Only _why_, when the reason is not clear from reading it. Examples: a workaround, a non-obvious limit, a subtle invariant.

- Keep changes narrow: a bug fix should not carry an unrelated refactor with it.

- Prefer editing files and patterns already in the codebase over adding a new abstraction for a one-off need.

## Commit messages

This repo enforces no strict format. Commit messages tend to follow a `type: summary` shape (`fix:`, `feat:`, `perf:`, `chore:`, `docs:`, `style:`). It matches what you see in `git log`. The shape matters more than it used to.

A bot turns commit subjects into `CHANGELOG.md` entries on release. Write the subject as the entry.

Added takes `feat:`. Fixed takes `fix:`. Changed takes `perf:`. Security takes `security:`. Other types stay out of the changelog.

Use `security:` for security fixes rather than `fix(security):` so they land in the right section. End the subject with the issue ref when there is one. Example: `fix: Stored summaries render without clickable links (#212)`. Put the details in the body.

## Privacy is the point

The core promise of Apogee: page content and generated summaries and answers never leave your device. Exceptions: your own local Ollama or llama.cpp server over loopback, plus the documented fetches in `PRIVACY.md`. If a change would add a new outbound network call, say so clearly in the PR text.

Four places state permissions and network use, and they must match. A claim that lives in one and not the others is exactly what store reviewers catch:

- `apogee-extension/manifest.json`, the source of truth

- [Privacy](README.md#privacy) in the README

- [PRIVACY.md](PRIVACY.md), the published policy the store listing links to

- `STORE-LISTING.md`, which carries a reason per permission

Adding, removing, or reusing a permission or a host means editing all four in the same PR.

## Reporting bugs / requesting features

Open an issue with the templates under `.github/ISSUE_TEMPLATE/`. Include your browser and version, the extension version (`chrome://extensions`), and whether you use WebLLM or Local Ollama mode.

## What gets reviewed and what does not

Apogee welcomes contributions year-round, including during [Hacktoberfest](https://hacktoberfest.com/). The same bar applies either way:

- **Reviewed**: bug fixes, new extractors, tests, and doc changes that fix something actually wrong or missing

- **Closed without review**: whitespace-only reformatting, unasked dependency bumps, and README edits that reword working prose without adding facts. These get the `spam` or `invalid` label

Quality over count. One working extractor is worth more here than four cosmetic PRs.
