import test from "node:test";
import assert from "node:assert";

import { readSource, functionBody } from "../helpers/readSource.js";

const popupJs = readSource("../../ui/app.js", import.meta.url);

function summarizeActivePageBody() {
  return functionBody(
    popupJs,
    "summarizeActivePage",
    "const EMPTY_ANSWER_MESSAGE",
  );
}

// Switching formats only changes the model prompt, so the extraction half is
// avoidable when the content is already in memory or cached (#177).
test("summarizeActivePage reuses cached page data instead of re-extracting (#177)", () => {
  const body = summarizeActivePageBody();
  assert.match(
    body,
    /const pageData = await getPageData\(tab\);/,
    "must go through the memory/disk cache instead of extracting",
  );
  assert.ok(
    !body.includes("extractFromActiveTab(tab)"),
    "must not extract directly when the cache path applies",
  );
});

test("summarizeActivePage reuses cached PDF text before re-extracting (#177)", () => {
  const body = summarizeActivePageBody();
  assert.match(
    body,
    /let pdfContent = pageData\.content;/,
    "must prefer already-extracted PDF text",
  );
  assert.match(
    body,
    /if \(!pdfContent\) \{/,
    "must only hit the PDF extractor when the text is still missing",
  );
});

test("summarizeActivePage drops a stale in-memory selection before reusing the cache (#177)", () => {
  const body = summarizeActivePageBody();
  assert.match(
    body,
    /if \(currentPageData\?\.type === "selection"\) currentPageData = null;/,
    "a selection summary must not be re-summarized and cached as the page",
  );
});
