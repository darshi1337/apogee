import test from "node:test";
import assert from "node:assert";
import {
  formatSummaryAsJSON,
  formatSummaryAsMarkdown,
  formatSummaryAsPlainText,
  safeExportFilename,
} from "../../lib/util/exportFormat.js";

test("formatSummaryAsMarkdown includes title, source, and summary", () => {
  const result = formatSummaryAsMarkdown({
    title: "Example Article",
    url: "https://example.com/article",
    summary: "- First point\n- Second point",
  });
  assert.strictEqual(
    result,
    "# Example Article\n\nSource: https://example.com/article\n\n- First point\n- Second point\n",
  );
});

test("formatSummaryAsMarkdown falls back to a generic heading with no title", () => {
  const result = formatSummaryAsMarkdown({
    title: "",
    url: "https://example.com",
    summary: "Some text.",
  });
  assert.ok(result.startsWith("# Summary\n\n"));
});

test("formatSummaryAsMarkdown omits the source line with no url", () => {
  const result = formatSummaryAsMarkdown({
    title: "Title",
    url: "",
    summary: "Body text.",
  });
  assert.strictEqual(result, "# Title\n\nBody text.\n");
  assert.ok(!result.includes("Source:"));
});

test("formatSummaryAsMarkdown handles an empty summary", () => {
  const result = formatSummaryAsMarkdown({
    title: "Title",
    url: "https://example.com",
    summary: "",
  });
  assert.strictEqual(result, "# Title\n\nSource: https://example.com\n");
});

test("formatSummaryAsMarkdown includes YAML frontmatter when includeFrontmatter is true", () => {
  const result = formatSummaryAsMarkdown({
    title: "Obsidian Note",
    url: "https://example.com/obsidian",
    summary: "- Important point",
    date: "2026-08-18",
    model: "Qwen 2.5 1.5B",
    format: "bullets",
    language: "English",
    includeFrontmatter: true,
  });
  assert.ok(
    result.startsWith(
      '---\ntitle: "Obsidian Note"\nurl: "https://example.com/obsidian"\ndate: "2026-08-18"\nmodel: "Qwen 2.5 1.5B"\nformat: "bullets"\nlanguage: "English"\n---',
    ),
  );
  assert.ok(
    result.includes(
      "# Obsidian Note\n\nSource: https://example.com/obsidian\n\n- Important point\n",
    ),
  );
});
test("formatSummaryAsPlainText removes Markdown formatting", () => {
  const result = formatSummaryAsPlainText({
    title: "Example Article",
    url: "https://example.com/article",
    summary: "## Key points\n\n- **First point**\n- _Second point_",
  });

  assert.strictEqual(
    result,
    "Example Article\n\nSource: https://example.com/article\n\nKey points\n\n- First point\n- Second point\n",
  );
});

test("formatSummaryAsJSON includes all fields and preserves summary structure", () => {
  const result = formatSummaryAsJSON({
    title: "Example Article",
    url: "https://example.com/article",
    model: "Qwen 2.5 1.5B",
    format: "bullets",
    language: "English",
    summary: "- First point\n- Second point",
    suggestedQuestions: ["What next?"],
  });

  assert.deepStrictEqual(JSON.parse(result), {
    title: "Example Article",
    url: "https://example.com/article",
    model: "Qwen 2.5 1.5B",
    format: "bullets",
    language: "English",
    summary: "- First point\n- Second point",
    suggestedQuestions: ["What next?"],
  });
});

test("formatSummaryAsJSON defaults missing fields and non-array questions", () => {
  const result = JSON.parse(formatSummaryAsJSON({}));
  assert.deepStrictEqual(result, {
    title: "",
    url: "",
    model: "",
    format: "",
    language: "",
    summary: "",
    suggestedQuestions: [],
  });

  const nonArray = JSON.parse(
    formatSummaryAsJSON({ suggestedQuestions: "nope" }),
  );
  assert.deepStrictEqual(nonArray.suggestedQuestions, []);
});

test("safeExportFilename strips illegal characters and falls back", () => {
  assert.strictEqual(
    safeExportFilename('Report: Q&A / test<>:"/\\|?*'),
    "Report Q&A test",
  );
  assert.strictEqual(safeExportFilename(""), "summary");
  assert.strictEqual(safeExportFilename("   "), "summary");
});
