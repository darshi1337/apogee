# Extractor tests

Extractors turn a web page into the clean text Apogee summarizes. There's one per supported site in `content/extractors/`, and they're the most self-contained part of the codebase, which makes them a good place to start contributing.

**You don't need a browser, a GPU, or a downloaded model to work on one.** These tests run in Node:

```bash
npm test
```

## Worked examples

Read the one closest to what you're building:

| File                 | Shows                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| `arxiv.test.js`      | Clean extraction of title, authors, subjects, and abstract from arXiv   |
| `bilibili.test.js`   | Subtitle fetch via `chrome` stub, multi-part page selection, null cases |
| `gmail.test.js`      | The simplest shape: synchronous, DOM only                               |
| `github.test.js`     | Landing page, issues, and fetching diffs for pull requests              |
| `hackernews.test.js` | Feeding the shared thread representation in `thread.js`                 |
| `lobsters.test.js`   | Another thread-based extractor, same shape as Hacker News               |
| `reddit.test.js`     | An extractor that reads a site API, with `fetch` stubbed                |
| `thread.test.js`     | Testing shared machinery directly, with no site extractor               |
| `wikipedia.test.js`  | Cutting a page down, and returning `null` to fall through               |
| `youtube.test.js`    | Caption URL security checks, transcript parsing, and `chrome` stubbing  |

## Writing a test

`loadExtractors()` builds a DOM from your fixture, evaluates the extractor scripts against it the way the extension injects them, and hands back the scope they declared themselves into:

```js
import { loadExtractors } from "./helpers/extractorHarness.js";

const { extractHackerNews } = loadExtractors({
  files: ["extractors/thread.js", "extractors/hackernews.js"],
  url: "https://news.ycombinator.com/item?id=100",
  fixture: "hackernews-item.html",
});

const result = extractHackerNews();
```

Options:

- **`files`** - paths under `content/`, in the same order `lib/extract/pageExtraction.js` injects them. Order matters: `thread.js` declares helpers the discussion extractors call, so it goes first.
- **`url`** - what the extractor sees as `location`. Most extractors branch on the path (`extractHackerNews` bails unless it's `/item`), so this has to be a realistic URL for the page your fixture came from.
- **`fixture`** - a filename in `fixtures/`. Use `html` instead for markup short enough to read inline.
- **`fetch`** - a stub, required only if the extractor makes requests. Left out, a call to `fetch` throws, and throws again from a macrotask so the run fails even if the extractor swallows it. That second throw is deliberate: extractors like `reddit.js` catch their own request failures and return `null`, so without it a forgotten stub would look exactly like a page the extractor declined to handle, and your test would pass while asserting nothing.
- **`chrome`** - a stub for `chrome.runtime.sendMessage`, same idea. The YouTube and Bilibili extractors route their transcript requests through the service worker this way.

## Capturing a fixture

Open the page, save it (`Ctrl+S`, "Webpage, HTML Only"), and trim it to the markup your extractor reads. Small, hand-trimmed fixtures beat full page dumps: they're reviewable, they survive the site's next redesign of everything you don't touch, and they don't carry someone's real data.

Some rules that will save you time:

- **Scrub personal data.** Usernames, emails, and avatars from a real page don't belong in the repo. Rewrite them to `alice`/`bob`, as the existing fixtures do.
- **Keep the markup well-formed.** The parser is literal and won't synthesize `<html>`/`<head>` around a stray `<title>` the way a browser does.
- **Fixtures are exempt from Prettier** (see `.prettierignore`). Extractors read `innerText`, so reflowing markup can change what a test asserts.

## What this can't cover

The DOM here comes from [linkedom](https://github.com/WebReflection/linkedom), which is a parser, not a browser. There's no layout and no CSS, so anything depending on computed styles, element geometry, visibility, or lazy-loading still needs checking by hand in the extension.

Also test the boring case: **every extractor must return `null` for pages it doesn't specifically handle** (a subreddit listing, a GitHub code file, the HN front page) so `content/content.js` falls through to the generic Readability extractor. Gmail is the one exception, and its test explains why.
