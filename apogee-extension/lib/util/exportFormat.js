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
export function formatSummaryAsPlainText({ title, url, summary }) {
  const plainSummary = (summary || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/[*_~`]/g, "");

  const parts = [title || "Summary"];
  if (url) parts.push(`Source: ${url}`);
  parts.push(plainSummary);

  return parts.join("\n\n").trim() + "\n";
}

export function formatSummaryAsJSON({
  title,
  url,
  model,
  format,
  language,
  summary,
  suggestedQuestions = [],
}) {
  return JSON.stringify(
    {
      title: title || "",
      url: url || "",
      model: model || "",
      format: format || "",
      language: language || "",
      summary: typeof summary === "string" ? summary : "",
      suggestedQuestions: Array.isArray(suggestedQuestions)
        ? suggestedQuestions
        : [],
    },
    null,
    2,
  );
}

// Page titles can contain characters that are illegal in file names
// (e.g. `/`, `\`, `:`) or that browsers interpret as paths. Strip those,
// collapse whitespace, and fall back to "summary" so the JSON download
// always gets a safe, single-segment file name.
export function safeExportFilename(title, fallback = "summary") {
  const cleaned = String(title || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}
