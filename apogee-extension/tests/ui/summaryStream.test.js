import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { readSource } from "../helpers/readSource.js";
import { renderSummaryStream } from "../../ui/summaryStream.js";

test("a long summary redraws less often while new chunks keep arriving", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const preview = [];
  let countAfterBurst;

  async function* chunks() {
    yield "Short summary";
    for (let i = 0; i < 10; i++) {
      t.mock.timers.tick(10);
      yield ".";
    }
    const shortRenderCount = preview.length;
    assert.ok(shortRenderCount >= 2, "short text previews promptly");

    yield "a".repeat(48 * 1024);
    t.mock.timers.tick(300);
    const longStartCount = preview.length;
    for (let i = 0; i < 10; i++) {
      t.mock.timers.tick(10);
      yield ".";
    }
    assert.equal(preview.length, longStartCount);
    t.mock.timers.tick(160);
    assert.equal(preview.length, longStartCount + 1);
    assert.ok(preview.at(-1).endsWith(".........."));
    countAfterBurst = preview.length;
  }

  await renderSummaryStream(chunks(), (text) => preview.push(text));
  assert.equal(preview.length, countAfterBurst + 1);
});

test("completion renders the full cleaned summary immediately and cancels the preview", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const renders = [];
  async function* chunks() {
    yield "  ";
    t.mock.timers.tick(500);
    assert.deepEqual(renders, []);
    yield "## Summary\n";
    yield "**Complete**";
  }

  const result = await renderSummaryStream(chunks(), (text) =>
    renders.push(text),
  );
  assert.equal(result, "**Complete**");
  t.mock.timers.tick(500);
  assert.deepEqual(renders, [result]);
});

test("a rejected stream cannot redraw over the error or a later attempt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const renders = [];
  const error = new Error("stream interrupted");
  async function* chunks() {
    yield "Incomplete";
    throw error;
  }

  await assert.rejects(
    renderSummaryStream(chunks(), (text) => renders.push(text)),
    error,
  );
  t.mock.timers.tick(500);
  assert.deepEqual(renders, []);
});

test("switching tabs with a preview queued preserves the new tab's summary", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = readSource("../../ui/app.js", import.meta.url);
  const start = app.indexOf("async function consumeSummaryStream(");
  const end = app.indexOf("async function extractAndCopyPage()", start);
  const stateStart = app.indexOf("function buildSummaryCompletedState(");
  const stateEnd = app.indexOf("// Single writer", stateStart);
  assert.ok(
    start >= 0 && end > start && stateStart >= 0 && stateEnd > stateStart,
  );
  let activeTabId = 1;
  const summaryText = { text: "" };
  const saved = [];
  const context = {
    summaryText,
    renderSummaryStream,
    setMarkdownHtml: (element, text) => {
      element.text = text;
    },
    currentPageData: { type: "article" },
    currentSummaryLanguage: "en",
    currentTranslationEngine: "off",
    timeSavedInputsFor: ({ type }) => ({ type }),
    saveSummaryViewState: async (tabId, jobId, state) => {
      saved.push({ tabId, jobId, state });
    },
  };
  const consume = runInNewContext(
    app.slice(stateStart, stateEnd) +
      app.slice(start, end) +
      "\nconsumeSummaryStream",
    context,
  );
  const original = "Tab A summary. ".repeat(4_000);
  async function* chunks() {
    yield original;
    t.mock.timers.tick(50);
    activeTabId = 2;
    context.currentPageData = { type: "selection", content: "Tab B selection" };
    context.currentSummaryLanguage = "es";
    summaryText.text = "Tab B saved summary";
    t.mock.timers.tick(200);
    assert.equal(summaryText.text, "Tab B saved summary");
    yield "Done";
  }

  await consume(chunks(), {
    tab: { id: 1 },
    jobId: "tab-a",
    isCurrent: () => activeTabId === 1,
    pageContext: {
      pageData: { type: "article" },
      language: "en",
      translationEngine: "off",
    },
  });
  assert.equal(summaryText.text, "Tab B saved summary");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].tabId, 1);
  assert.equal(saved[0].jobId, "tab-a");
  assert.equal(saved[0].state.summaryText, original + "Done");
  assert.equal(saved[0].state.timeSaved.type, "article");
  assert.equal(saved[0].state.summaryLanguage, "en");
  assert.equal(saved[0].state.isSelection, false);
});

test("a job that lost the view before streaming still saves and can repaint", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = readSource("../../ui/app.js", import.meta.url);
  const start = app.indexOf("async function consumeSummaryStream(");
  const end = app.indexOf("async function extractAndCopyPage()", start);
  const stateStart = app.indexOf("function buildSummaryCompletedState(");
  const stateEnd = app.indexOf("// Single writer", stateStart);
  assert.ok(
    start >= 0 && end > start && stateStart >= 0 && stateEnd > stateStart,
  );
  let activeTabId = 2; // switched away before the stream started
  const summaryText = { text: "Tab B view" };
  const saved = [];
  const context = {
    summaryText,
    renderSummaryStream,
    setMarkdownHtml: (element, text) => {
      element.text = text;
    },
    currentPageData: { type: "selection", content: "Tab B selection" },
    currentSummaryLanguage: "es",
    currentTranslationEngine: "off",
    currentSummaryText: "",
    currentPromptsCacheKey: null,
    makeSummaryPassagesFocusable() {},
    showSummaryContext() {},
    setSummaryCopyButtonsVisible() {},
    updateResummarizeHint() {},
    updateTimeSavedBadge() {},
    setSuggestedQuestionsLoading() {},
    setSuggestedQuestions() {},
    chrome: { storage: { local: { get: async () => ({}) } } },
    timeSavedInputsFor: ({ type }) => ({ type }),
    saveSummaryViewState: async (tabId, jobId, state) => {
      saved.push({ tabId, jobId, state });
    },
  };
  const consume = runInNewContext(
    app.slice(stateStart, stateEnd) +
      app.slice(start, end) +
      "\nconsumeSummaryStream",
    context,
  );

  async function* chunks() {
    yield "Tab A summary.";
    t.mock.timers.tick(50);
    assert.equal(summaryText.text, "Tab B view");
    activeTabId = 1; // came back mid-stream
    yield " More.";
    t.mock.timers.tick(50);
  }

  await consume(chunks(), {
    tab: { id: 1 },
    jobId: "tab-a",
    isCurrent: () => activeTabId === 1,
    pageContext: {
      pageData: { type: "article" },
      language: "en",
      translationEngine: "off",
    },
  });
  assert.equal(summaryText.text, "Tab A summary. More.");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].tabId, 1);
  assert.equal(saved[0].jobId, "tab-a");
  assert.equal(saved[0].state.summaryText, "Tab A summary. More.");
  assert.equal(saved[0].state.timeSaved.type, "article");
  assert.equal(saved[0].state.summaryLanguage, "en");
  assert.equal(saved[0].state.isSelection, false);
});
