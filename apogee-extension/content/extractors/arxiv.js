const ARXIV_ABSTRACT_PATH =
  /^\/abs\/((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)\/?$/i;

function arxivField(root, selector, label) {
  const text = root.querySelector(selector)?.textContent || "";
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(`^${label}\\s*:\\s*`, "i"), "")
    .trim();
}

function extractArxiv() {
  const pathMatch = location.pathname.match(ARXIV_ABSTRACT_PATH);
  if (!pathMatch) return null;

  const root = document.querySelector("#abs");
  if (!root) return null;

  const arxivId = pathMatch[1];
  const pdfUrl = new URL(`/pdf/${arxivId}`, location.origin).href;
  const title = arxivField(root, ".title", "Title");
  const authors = arxivField(root, ".authors", "Authors");
  const subjects = arxivField(root, ".subjects", "Subjects");
  const abstract = arxivField(root, ".abstract", "Abstract");
  if (!title || !authors || !subjects || !abstract) return null;

  return {
    type: "article",
    title,
    url: location.href,
    content: [
      `# ${title}`,
      `## Authors\n${authors}`,
      `## Subjects\n${subjects}`,
      `## arXiv ID\n\`${arxivId}\``,
      `## PDF\n[Open PDF](${pdfUrl})`,
      `## Abstract\n${abstract}`,
    ].join("\n\n"),
  };
}
