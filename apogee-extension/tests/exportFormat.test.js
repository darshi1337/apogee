import test from "node:test";
import assert from "node:assert";
import { formatSummaryAsMarkdown } from "../lib/exportFormat.js";

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
