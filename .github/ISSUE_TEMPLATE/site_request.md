---
name: Site support request
about: A page or site that Apogee extracts badly or not at all
title: ""
labels: extractor
---

**Site**
Paste the URL of a public page that shows the problem. If the page needs a login, say so and describe its shape instead (article, thread, video page).

**What Apogee does today**
What does the summary look like on this page? Empty, wrong text, missing comments, paywall boilerplate?

**What the page holds**
What should Apogee have picked up? Title, body, comments, transcript?

**Fixture**
If you can, save the page HTML and attach it (strip anything private first). Fixtures let a contributor build and test an extractor with plain Node, no browser needed. See `apogee-extension/tests/extractors/README.md` for the harness.

**Willing to build it?**
Extractors are the most self-contained work in this repo. If you want to write one, say so and a maintainer will point at the closest example to copy. `content/extractors/hackernews.js` and `reddit.js` are good starting points.
