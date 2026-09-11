---
name: New site extractor
about: Propose (or claim) support for extracting a specific site
title: "Add a <site> extractor"
labels: extractor
---

**Which site?**
Name it, plus an example URL for the page type this handles.

**What does Apogee do there today?**
Every site falls through to the generic Readability extractor unless someone wrote one for it. Say what that produces now and why it is not good enough.

Examples: missing comments, mangled structure, navigation furniture pulled into the text, content behind a lazy-loaded SPA, and so on.

**Which pages should it handle, and which should it skip?**
An extractor must return `null` for pages outside its scope (listing pages, profiles, search results). Those pages keep falling through to Readability. List both sides.

- Handles:

- Returns `null` for:

**Is the content in the DOM, or in an API?**
Both patterns already exist to copy from:

- Server-rendered DOM, read it directly: `content/extractors/hackernews.js`

- Same-origin JSON the site already serves, `fetch` it:
  `content/extractors/reddit.js`

If the site has a comment tree, `content/extractors/thread.js` gives you the reply hierarchy, path notation, and selection for free.

**Anything unusual about the page?**
Infinite scroll, shadow DOM, content that appears only after interaction, login walls, region differences. These facts usually decide whether an extractor takes an evening or a week.

---

<!-- Keep this section. It states what "done" means. -->

**Done means this**

- [ ] Extractor added under `content/extractors/`, registered in
      `content/content.js` and in the injection list in
      `lib/extract/pageExtraction.js`

- [ ] Returns `null` for the pages listed above

- [ ] A test under `tests/extractors/` with a trimmed, scrubbed HTML fixture.
      See [tests/extractors/README.md](../../apogee-extension/tests/extractors/README.md).
      This part needs no browser or model download

- [ ] `npm run format:check`, `npm run lint`, `npm test`, `npm run build` all pass

- [ ] No new host permission. If the site needs one, say so in the PR. That
      means updating the manifest, README, PRIVACY.md and STORE-LISTING.md
      together
