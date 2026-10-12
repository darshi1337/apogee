export function formatSummaryAsMarkdown({
  title,
  url,
  summary,
  date,
  model,
  format,
  language,
  includeFrontmatter = false,
}) {
  const parts = [];

  if (includeFrontmatter) {
    const frontmatterLines = ["---"];
    if (title) frontmatterLines.push(`title: ${JSON.stringify(title)}`);
    if (url) frontmatterLines.push(`url: ${JSON.stringify(url)}`);
    if (date) frontmatterLines.push(`date: ${JSON.stringify(date)}`);
    if (model) frontmatterLines.push(`model: ${JSON.stringify(model)}`);
    if (format) frontmatterLines.push(`format: ${JSON.stringify(format)}`);
    if (language)
      frontmatterLines.push(`language: ${JSON.stringify(language)}`);
    frontmatterLines.push("---");
    parts.push(frontmatterLines.join("\n"));
  }

  const heading = title ? `# ${title}` : "# Summary";
  parts.push(heading);
  if (url) parts.push(`Source: ${url}`);
  parts.push(summary || "");
  return parts.join("\n\n").trim() + "\n";
}
export function formatSummaryAsJSON(item) {
  return JSON.stringify(normalizeSummaryItem(item), null, 2);
}

// One shared shape for single and bulk JSON exports.
function normalizeSummaryItem(item) {
  return {
    title: item?.title || "",
    url: item?.url || "",
    model: item?.model || "",
    format: item?.format || "",
    language: item?.language || "",
    summary: typeof item?.summary === "string" ? item.summary : "",
    suggestedQuestions: Array.isArray(item?.suggestedQuestions)
      ? item.suggestedQuestions
      : [],
  };
}

export function formatSummariesBulkAsJSON(summaries) {
  const items = (Array.isArray(summaries) ? summaries : []).map((item) =>
    normalizeSummaryItem(item ?? {}),
  );
  return JSON.stringify(items, null, 2) + "\n";
}

// Titles can hold path characters or whitespace, so strip them down to a
// safe single-segment download name, falling back to "summary".
export function safeExportFilename(title, fallback = "summary") {
  const cleaned = String(title || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}
