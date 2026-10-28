import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { searchPastSummaries } from "../../lib/retrieval/pastSummariesSearch.js";
import { parseHTML } from "linkedom";

// app.js owns DOM globals at import time, so these tests assert on its
// source (same precedent as finalizeFailure.test.js) plus the search
// behavior the popup now relies on.

const appSource = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

function filterPastSummariesSource() {
  const start = appSource.indexOf("async function filterPastSummaries");
  assert.ok(start !== -1, "filterPastSummaries exists");
  const end = appSource.indexOf("if (pastSummariesFilter)", start);
  assert.ok(end !== -1, "filterPastSummaries has a clear end");
  return appSource.slice(start, end);
}

test("popup search runs over the full index, not the last-8 slice (#313)", () => {
  const body = filterPastSummariesSource();
  assert.ok(
    !body.includes("PAST_SUMMARIES_SHOWN"),
    "filter must not window to 8",
  );
  assert.ok(
    body.includes("storedSummaries: stored"),
    "filter searches fetched texts",
  );
});

test("popup delete goes through the atomic storage helper (#313)", () => {
  assert.ok(appSource.includes("await removeCachedSummary(entry.s)"));
});

test("search finds summaries older than the last 8 (#313)", async () => {
  const cacheOrder = Array.from({ length: 12 }, (_, i) => ({
    s: `k${i}`,
    p: `p${i}`,
    t: `Article ${i}`,
  }));
  const storedSummaries = Object.fromEntries(
    cacheOrder.map((e) => [e.s, `Body text for ${e.s}`]),
  );
  storedSummaries.k0 = "Body text with a UNIQUEWORD cavern-wall ancients";

  const results = await searchPastSummaries({
    query: "UNIQUEWORD",
    cacheOrder,
    storedSummaries,
    embedTextsFn: null,
  });

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].s, "k0");
});

// buildPastSummaryCard needs a browser, so pull its source and run it
// against linkedom with simple stand-ins for everything it calls

function makeCard(entry = { s: "k1", p: "p1", t: "My Title" }) {
  const start = appSource.indexOf("function buildPastSummaryCard");
  const end = appSource.indexOf("// One targeted read", start);
  const fnSource = appSource.slice(start, end);

  const { document } = parseHTML("<html><body></body></html>");
  const build = new Function(
    "document",
    "icon",
    "firstLineOf",
    "setMarkdownHtml",
    "copyToClipboard",
    "formatSummaryAsMarkdown",
    "formatSummaryAsJSON",
    "pastSummaryToExportItem",
    "removeCachedSummary",
    "loadPastSummaries",
    "chrome",
    fnSource + "\nreturn buildPastSummaryCard;",
  )(
    document,
    () => "",
    (text) => text.split("\n")[0],
    (el, text) => {
      el.textContent = text;
    },
    () => {},
    () => "",
    () => "",
    () => ({}),
    async () => {},
    async () => {},
    {},
  );

  const card = build(entry, "First line\nSecond line");
  document.body.appendChild(card);
  return card;
}

function click(el) {
  const Event = el.ownerDocument.defaultView.Event;
  el.dispatchEvent(new Event("click", { bubbles: true }));
}

test("past summary card is a group with a name, not a button", () => {
  const card = makeCard();
  assert.strictEqual(card.getAttribute("role"), "group");
  assert.strictEqual(card.getAttribute("aria-label"), "My Title");
  assert.strictEqual(card.getAttribute("tabindex"), null);
  assert.strictEqual(card.getAttribute("aria-expanded"), null);
});

test("past summary card uses the first line as its name when untitled", () => {
  const card = makeCard({ s: "k2", p: "p2", t: "" });
  assert.strictEqual(card.getAttribute("aria-label"), "First line");
});

test("copy and delete buttons are not inside the toggle", () => {
  const card = makeCard();
  const toggle = card.querySelector(".past-summary-toggle");
  assert.strictEqual(toggle.tagName, "BUTTON");
  assert.strictEqual(toggle.querySelector("button"), null);
  const others = card.querySelectorAll(".copy-btn, .delete-btn");
  assert.strictEqual(others.length, 3);
  for (const btn of others) {
    assert.strictEqual(toggle.contains(btn), false);
  }
});

test("toggle button expands and collapses the card", () => {
  const card = makeCard();
  const toggle = card.querySelector(".past-summary-toggle");
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
  click(toggle);
  assert.ok(card.classList.contains("expanded"));
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "true");
  click(toggle);
  assert.ok(!card.classList.contains("expanded"));
  assert.strictEqual(toggle.getAttribute("aria-expanded"), "false");
});

test("clicking the card expands it, clicking an action does not", async () => {
  const card = makeCard();
  click(card.querySelector(".past-summary-preview"));
  assert.ok(card.classList.contains("expanded"));
  click(card.querySelector(".past-summary-preview"));
  assert.ok(!card.classList.contains("expanded"));
  click(card.querySelector(".copy-btn"));
  click(card.querySelector(".delete-btn"));
  await new Promise(setImmediate);
  assert.ok(!card.classList.contains("expanded"));
});