const GH_MAX_COMMENTS = 40;
const GH_MAX_COMMENT_CHARS = 4000;
const GH_MAX_README_CHARS = 12000;
const GH_MAX_DIFF_CHARS = 30000;

function ghReadme() {
  const el =
    document.querySelector("#readme article.markdown-body") ||
    document.querySelector("#readme .markdown-body");
  return elText(el);
}

function ghConversation() {
  let blocks = Array.from(document.querySelectorAll(".timeline-comment"));
  if (!blocks.length) {
    blocks = Array.from(
      document.querySelectorAll('[data-testid="comment-viewer-outer-box"]'),
    );
  }
  if (!blocks.length) {
    blocks = Array.from(document.querySelectorAll(".markdown-body"));
  }

  return collectForgeComments(blocks, {
    maxComments: GH_MAX_COMMENTS,
    maxChars: GH_MAX_COMMENT_CHARS,
    getBodyText: (block) =>
      elText(block.querySelector?.(".comment-body, .markdown-body") || block),
    getAuthor: (block) =>
      elText(
        block.querySelector?.(
          '.author, a[data-testid="avatar-link"], .ActionListItem-label',
        ),
      ),
  });
}

function ghDomDiff() {
  // Best-effort unified diff scraped from the rendered "Files changed" DOM,
  // so summarizing a pull request never sends a cross-origin request off the
  // page you are already viewing. Covers both the legacy server-rendered
  // diff tables (.blob-code-*) and the newer viewer ([data-code-marker]).
  // Returns "" when no diff rows are rendered; the caller then falls back
  // to "(Diff unavailable.)".
  const seen = new Set();
  const lines = [];
  const cells = document.querySelectorAll(
    ".blob-code-addition .blob-code-inner, .blob-code-deletion .blob-code-inner, .blob-code-inner[data-code-marker]",
  );
  for (const cell of cells) {
    if (!cell || seen.has(cell)) continue;
    seen.add(cell);
    const marker =
      cell.getAttribute?.("data-code-marker") ||
      (cell.closest?.(".blob-code-addition") ? "+" : "-");
    if (marker !== "+" && marker !== "-") continue;
    const text = (cell.innerText || cell.textContent || "").replace(/\s+$/, "");
    if (!text) continue;
    lines.push(`${marker} ${text.replace(/^[+-]\s?/, "")}`);
  }
  if (!lines.length) return "";
  return truncateKeepLines(lines.join("\n"), GH_MAX_DIFF_CHARS);
}

async function extractGitHub() {
  const parts = location.pathname.split("/").filter(Boolean);
  const [owner, repo, section, number] = parts;
  if (!owner || !repo) return null;
  const repoSlug = `${owner}/${repo}`;

  const isPull = section === "pull" && /^\d+$/.test(number || "");
  const isIssue = section === "issues" && /^\d+$/.test(number || "");
  if (isPull || isIssue) {
    const kind = isPull ? "pull request" : "issue";
    const title =
      elText(
        document.querySelector(
          '.js-issue-title, bdi.js-issue-title, [data-testid="issue-title"]',
        ),
      ) ||
      elText(document.querySelector("h1")) ||
      document.title;
    const state = elText(
      document.querySelector('.State, [data-testid="header-state"]'),
    );
    const comments = ghConversation();

    return renderForgePage({
      label: `GitHub ${kind} in ${repoSlug} (#${number})`,
      title,
      state,
      comments,
      commentsHeader: "Comments",
      diff: isPull ? ghDomDiff() : null,
      type: "github",
    });
  }

  if (parts.length === 2) {
    const readme = ghReadme();
    if (!readme) return null;
    const description =
      document
        .querySelector('meta[property="og:description"]')
        ?.content?.trim() || "";
    const topics = Array.from(document.querySelectorAll("a.topic-tag"))
      .map((t) => elText(t))
      .filter(Boolean);

    let content = `GitHub repository: ${repoSlug}\n`;
    if (description) content += `\nDescription: ${description}\n`;
    if (topics.length) content += `Topics: ${topics.join(", ")}\n`;
    content += `\nREADME:\n${truncateKeepLines(readme, GH_MAX_README_CHARS)}\n`;

    return {
      type: "github",
      title: repoSlug,
      url: location.href,
      content: content.trim(),
    };
  }

  return null;
}
