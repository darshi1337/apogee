# Contributing to Apogee

Thanks for taking a look at Apogee. This project is a single package, `apogee-extension/`, a Chrome/Edge/Dia/Firefox browser extension.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Your first contribution

New here? Start with the [`good first issue`][gfi] list. Those are scoped so you can finish one without reading the whole extension first, and each says which files it touches and what "done" looks like.

What the labels mean:

- **`good first issue`**: self-contained, no deep context needed, an evening's work
- **`help wanted`**: real work we would like help with, but it assumes some familiarity with the codebase already
- **`extractor`**: adding or improving per-site page extraction, the most repeatable kind of contribution here. `content/extractors/hackernews.js` and `reddit.js` are two examples to copy from, `thread.js` is the shared machinery they both build on, `wikipedia.js` shows how to cut a long page down and hand back `null` for pages you do not handle, `bluesky.js` shows API-first extraction with DOM fallback, and `youtube.js` is an example of transcript extraction with `chrome` message stubbing

**Extractor work needs no browser, no GPU, and no model download.** Extractors run against saved HTML fixtures in plain Node, so `npm install && npm test` is the whole setup. See [`apogee-extension/tests/extractors/README.md`](apogee-extension/tests/extractors/README.md) for the harness and worked examples. If that is the kind of contribution you want to make, you can skip the browser setup below entirely.

### Claiming an issue

Comment on it and it'll be assigned to you, so two people don't write the same patch. If it goes seven days with no draft PR and no update, it gets unassigned and is fair game again. That isn't a judgement about you, it's so the next person isn't blocked by a claim that went quiet. If you're still on it and just need more time, say so on the issue and it stays yours.

One issue per PR, and please don't start on something already assigned to someone else.

If nothing on the list fits, open an issue describing what you want to change before writing it, especially for anything touching network behaviour or permissions.

Stuck partway through? Open a draft PR and ask. A half-finished branch with a specific question attached is easier to help with than a stalled one.

[gfi]: https://github.com/darshi1337/apogee/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22

## Getting set up

Use **Node 22 or newer**, which is what CI runs and what `.nvmrc` pins. Older versions differ in ways that show up as test failures which aren't your fault.

```bash
cd apogee-extension
npm install
npm run dev     # watch mode, rebuilds dist/chrome and dist/firefox on save
```

Load `apogee-extension/dist/chrome` (or `dist/firefox`) as an unpacked/temporary extension in your browser. See the main [README](README.md#get-started) for the project overview and [BROWSERS.md](BROWSERS.md) for per-browser notes.

If you're working on the **Local Ollama** provider, you'll also need Ollama installed and running; the extension reaches it directly with no `OLLAMA_ORIGINS` setup (see the [Local Ollama Guide](OLLAMA.md)).

## Before opening a PR

Run these from `apogee-extension/` (`lint`, `test`, and `build` are also mirrored at the repo root, but `format:check` is not):

```bash
npm run format:check   # prettier --check .
npm run lint           # eslint .
npm test               # node --test
npm run build           # builds both dist/chrome and dist/firefox
```

CI runs the same four checks on every push and pull request, a PR won't be mergeable until they're green. On your first PR to the repo, CI waits for a maintainer to approve the run, so a workflow sitting at "pending" for a while is normal and not something you did wrong.

If `format:check` fails, run `npm run format` to auto-fix it.

**Don't edit `CHANGELOG.md`.** It's written when a version is released, not per PR. If everyone adds their own entry, every open PR conflicts with every other one, and then again after each merge. Describe the change in your PR description instead and it'll be credited at release.

### Test fixtures

If your change adds an HTML fixture under `tests/extractors/fixtures/`, trim it to the markup your extractor actually reads and replace real people's details with `alice`/`bob` placeholders, as the existing fixtures do. Saved pages carry someone else's copyrighted content and often real usernames, avatars, or, in Gmail's case, real mail. A small hand-trimmed fixture is better on every axis: reviewable, resilient to the site redesigning everything you didn't keep, and carrying nobody's personal data.

## Code style

- No comments explaining _what_ code does, only _why_, when the reason isn't obvious from reading it (a workaround, a non-obvious constraint, a subtle invariant).
- Keep changes scoped: a bug fix shouldn't carry an unrelated refactor along with it.
- Prefer editing existing files/patterns already in the codebase over introducing a new abstraction for a one-off need.

## Commit messages

This repo doesn't enforce a strict format, but commit messages generally follow a `type: summary` shape (`fix:`, `feat:`, `perf:`, `chore:`, `docs:`, `style:`), matching what you'll see in `git log`.

## Privacy is the point

Apogee's core guarantee is that page content and generated summaries/answers never leave your device except to your own local Ollama or llama.cpp server over loopback, plus the documented fetches listed in `PRIVACY.md`. If a change would introduce a new outbound network call, call that out explicitly in the PR description.

Permissions and network behaviour are described in four places, and they have to agree, a claim that lives in one and not the others is exactly what store reviewers catch:

- `apogee-extension/manifest.json`, the source of truth
- [Privacy](README.md#privacy) in the README
- [PRIVACY.md](PRIVACY.md), the published policy the store listing links to
- `STORE-LISTING.md`, which carries a justification per permission

Adding, removing, or repurposing a permission or a host means editing all four in the same PR.

## Reporting bugs / requesting features

Open an issue using the templates under `.github/ISSUE_TEMPLATE/`. Include your browser + version, the extension version (`chrome://extensions`), and whether you're using WebLLM or Local Ollama mode.

## What gets reviewed and what doesn't

Apogee welcomes contributions year-round, including during [Hacktoberfest](https://hacktoberfest.com/). The same bar applies either way:

- **Reviewed**: bug fixes, new extractors, tests, and documentation changes that fix something actually wrong or missing
- **Closed without review**: whitespace-only reformatting, unrequested dependency bumps, and README edits that reword working prose without adding information. These get the `spam` or `invalid` label

Quality over count. One working extractor is worth more here than four cosmetic PRs.
