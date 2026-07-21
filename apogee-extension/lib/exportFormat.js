// Formats a generated summary as a standalone Markdown note (title + source
// link + body), for the "Copy as Markdown" button in the summary card.
// Deliberately distinct from the plain "copy summary text" button
// (copySummaryBtn in popup.js, which just copies the raw text): this adds
// enough structure that the result reads as a real note on its own once
// pasted somewhere else, since the summary text alone has no title/source
// once it's out of the popup, and cache keys are hashed specifically so
// nothing here can recover that context after the fact.
export function formatSummaryAsMarkdown({ title, url, summary }) {
  const heading = title ? `# ${title}` : "# Summary";
  const parts = [heading];
  if (url) parts.push(`Source: ${url}`);
  parts.push(summary || "");
  return parts.join("\n\n").trim() + "\n";
}
