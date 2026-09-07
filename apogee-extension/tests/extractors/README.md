# Extractor tests

Extractors turn a web page into the clean text Apogee summarizes. There is one per supported site in `content/extractors/`, and they are the most self-contained part of the codebase, which makes them a good place to start helping.

**You need no browser, no GPU, and no downloaded model to work on one.** These tests run in Node:

```bash
npm test
```

## Worked examples

Read the one closest to what you build:

| File | Shows |
| --- | --- |
| `arxiv.test.js` | Clean pull of title, authors, subjects, and abstract from arXiv |
| `bilibili.test.js` | Subtitle fetch with `chrome` stub, multi-part page picking, null cases |
| `gmail.test.js` | The simplest shape: synchronous, DOM only |
| `github.test.js` | Landing page, issues, and fetching diffs for pull requests |
| `hackernews.test.js` | Feeding the shared thread form in `thread.js` |
| `lobsters.test.js` | Another thread-based extractor, same shape as Hacker News |
| `reddit.test.js` | An extractor that reads a site API, with `fetch` stubbed |
| `stackoverflow.test.js` | Question, accepted answer, score ranking, and comment order |
| `mastodon.test.js` | Federated host finding, main post, engagement, reply chains |
| `lemmy.test.js` | Post, community, scores, threaded comment chains |
| `discourse.test.js` | Topic, original post, category, reply post streams |
| `generic.test.js` | Readability fallback on plain articles |
| `content.test.js` | Dispatcher routing across extractors, including the SponsorBlock handoff |
| `thread.test.js` | Testing shared code straight, with no site extractor |
| `wikipedia.test.js` | Trimming a page down, and returning `null` to fall through |
| `bluesky.test.js` | API-first thread fetch with `fetch` stub and DOM fallback, depth and char caps |
| `youtube.test.js` | Caption URL security checks, transcript parsing, and `chrome` stubbing |

## Writing a test

`loadExtractors()` builds a DOM from your fixture, runs the extractor scripts against it the way the extension injects them, and hands back the scope they stated for themselves:

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

- **`files`** - paths under `content/`, in the same order `lib/extract/pageExtraction.js` injects them. Order matters: `thread.js` states helpers the discussion extractors call, so it goes first.
- **`url`** - what the extractor sees as `location`. Most extractors branch on the path (`extractHackerNews` stops unless it is `/item`), so this must be a realistic URL for the page your fixture came from.
- **`fixture`** - a filename in `fixtures/`. Use `html` instead for markup short enough to read inline.
- **`fetch`** - a stub, needed only if the extractor makes requests. Left out, a call to `fetch` throws, and throws again from a macrotask so the run fails even if the extractor swallows it. That second throw is on purpose: extractors such as `reddit.js` catch their own request failures and return `null`, so without it a missing stub would look exactly like a page the extractor declined to handle, and your test would pass while checking nothing.
- **`chrome`** - a stub for `chrome.runtime.sendMessage`, same idea. The YouTube and Bilibili extractors send their transcript requests through the service worker this way.

## Capturing a fixture

Open the page, save it (`Ctrl+S`, "Webpage, HTML Only"), and trim it to the markup your extractor reads. Small, hand-trimmed fixtures beat full page dumps: they are reviewable, they live through the site next redesign of all you do not touch, and they carry nobody real data.

Some rules that save you time:

- **Scrub personal data.** Usernames, emails, and avatars from a real page do not belong in the repo. Rewrite them to `alice`/`bob`, as the current fixtures do.
- **Keep the markup well-formed.** The parser is literal and will not build `<html>`/`<head>` around a stray `<title>` the way a browser does.
- **Fixtures are exempt from Prettier** (see `apogee-extension/.prettierignore`). Extractors read `innerText`, so reflowing markup can change what a test checks.

## What this can't cover

The DOM here comes from [linkedom](https://github.com/WebReflection/linkedom), which is a parser, not a browser. There is no layout and no CSS, so anything tied to computed styles, element shape, visibility, or lazy-loading still needs checking by hand in the extension.

Also test the plain case: **each extractor must return `null` for pages it does not handle in particular** (a subreddit listing, a GitHub code file, the HN front page) so `content/content.js` falls through to the generic Readability extractor. Gmail is the one exception, and its test explains why.
