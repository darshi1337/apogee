import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

const URL_MODERN = "https://arxiv.org/abs/2401.01234v2";

function extract(options = {}) {
  const { extractArxiv } = loadExtractors({
    files: ["extractors/arxiv.js"],
    url: URL_MODERN,
    fixture: "arxiv-abstract.html",
    ...options,
  });
  return extractArxiv();
}

test("extractArxiv preserves the four abstract fields", () => {
  const result = extract();

  assert.strictEqual(result.type, "article");
  assert.strictEqual(result.title, "A Synthetic Study of Quiet Machines");
  assert.strictEqual(result.url, URL_MODERN);
  assert.match(result.content, /^# A Synthetic Study of Quiet Machines$/m);
  assert.match(result.content, /^## Authors\nAlice Example, Bob Example$/m);
  assert.match(
    result.content,
    /^## Subjects\nArtificial Intelligence \(cs\.AI\); Computation and Language \(cs\.CL\)$/m,
  );
  assert.match(result.content, /^## arXiv ID\n`2401\.01234v2`$/m);
  assert.match(
    result.content,
    /^## PDF\n\[Open PDF\]\(https:\/\/arxiv\.org\/pdf\/2401\.01234v2\)$/m,
  );
  assert.match(
    result.content,
    /^## Abstract\nWe describe a fictional machine that sorts imaginary signals while preserving their order\./m,
  );
});

test("extractArxiv strips descriptor labels and page furniture", () => {
  const content = extract().content;

  for (const gone of [
    "Title:",
    "Authors:",
    "Subjects:",
    "Abstract:",
    "View PDF",
    "HTML paper",
    "Submission history",
    "Citation tools",
    "Related papers",
    "arXivLabs",
    "Download controls",
    "site navigation",
  ]) {
    assert.ok(!content.includes(gone), `expected "${gone}" to be excluded`);
  }
});

test("extractArxiv supports historical identifiers containing a slash", () => {
  const result = extract({ url: "https://arxiv.org/abs/hep-th/9901001v3" });

  assert.strictEqual(result.type, "article");
  assert.match(result.content, /^## arXiv ID\n`hep-th\/9901001v3`$/m);
  assert.match(
    result.content,
    /^## PDF\n\[Open PDF\]\(https:\/\/arxiv\.org\/pdf\/hep-th\/9901001v3\)$/m,
  );
  assert.match(result.content, /^## Abstract$/m);
});

test("extractArxiv returns null for non-abstract arXiv pages", () => {
  for (const url of [
    "https://arxiv.org/",
    "https://arxiv.org/list/cs.AI/recent",
    "https://arxiv.org/search/?query=quiet+machines&searchtype=all",
    "https://arxiv.org/pdf/2401.01234",
    "https://arxiv.org/html/2401.01234",
  ]) {
    assert.strictEqual(extract({ url }), null, `expected null for ${url}`);
  }
});

test("arXiv PDF pages use the existing PDF extraction path", async () => {
  const context = loadExtractors({
    files: ["extractors/arxiv.js", "content.js"],
    url: "https://arxiv.org/pdf/2401.01234",
    fixture: "arxiv-abstract.html",
  });
  Object.defineProperty(context.document, "contentType", {
    value: "application/pdf",
    configurable: true,
  });

  const result = await context.window.extractPageContent();

  assert.strictEqual(result.title, "A Synthetic Study of Quiet Machines");
  assert.strictEqual(result.url, "https://arxiv.org/pdf/2401.01234");
  assert.strictEqual(result.content, null);
  assert.strictEqual(result.isPdf, true);
});

test("extractArxiv returns null for malformed or missing abstracts", () => {
  assert.strictEqual(
    extract({ url: "https://arxiv.org/abs/not-an-identifier" }),
    null,
  );
  assert.strictEqual(
    extract({
      html: `<div id="abs">
               <h1 class="title">Title: Incomplete Paper</h1>
               <div class="authors">Authors: Alice Example</div>
               <div class="subjects">Subjects: Artificial Intelligence</div>
             </div>`,
      fixture: undefined,
    }),
    null,
  );
  assert.strictEqual(
    extract({
      html: `<div id="abs">
               <h1 class="title">Title: Incomplete Paper</h1>
               <div class="authors">Authors: Alice Example</div>
               <div class="subjects">Subjects: Artificial Intelligence</div>
               <blockquote class="abstract">Abstract:</blockquote>
             </div>`,
      fixture: undefined,
    }),
    null,
  );
});

test("extractArxiv reads the DOM without a network dependency", () => {
  let fetched = false;
  const result = extract({
    fetch() {
      fetched = true;
      throw new Error("unexpected fetch");
    },
  });

  assert.strictEqual(result.type, "article");
  assert.strictEqual(fetched, false);
});
