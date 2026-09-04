const GL_MAX_COMMENTS = 40;
const GL_MAX_COMMENT_CHARS = 4000;
const GL_MAX_DIFF_CHARS = 30000;

function glTruncate(text, max) {
  return threadTruncate(text, max, { preserveLines: true });
}

function glComments() {
  const selectors = [
    '[data-testid="note-body"]',
    ".note-body",
    ".discussion-body",
    ".md-area",
    ".markdown-area",
  ];
  const seen = new Set();
  const out = [];
  for (const selector of selectors) {
    for (const body of document.querySelectorAll(selector)) {
      const text = (body?.innerText || body?.textContent || "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const container = body.closest?.(
        '.note, .discussion-note, [data-testid="note"]',
      );
      const author =
        container
          ?.querySelector?.(
            '.author, .note-header a, [data-testid="author-link"]',
          )
          ?.innerText?.trim() || "";
      out.push({ author, text: glTruncate(text, GL_MAX_COMMENT_CHARS) });
      if (out.length >= GL_MAX_COMMENTS) return out;
    }
  }
  return out;
}

function glDiff() {
  // Best-effort unified diff scraped from the rendered diff DOM. Only
  // content cells are read — line-number cells (.diff-line-num) would leak
  // row numbers into the summary — and rows without an add/remove marker
  // (hunk headers, context outside a marked row) are skipped.
  const lines = [];
  const seen = new Set();
  const cells = document.querySelectorAll(
    ".diff-line-content, .line_holder .line_content",
  );
  for (const cell of cells) {
    const text = (cell?.innerText || cell?.textContent || "").replace(
      /\s+$/,
      "",
    );
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const parent = cell.closest?.(".line_holder, .diff-line");
    const marker = parent?.classList.contains("new")
      ? "+"
      : parent?.classList.contains("old")
        ? "-"
        : "";
    if (marker !== "+" && marker !== "-") continue;
    lines.push(`${marker} ${text.replace(/^[+-]\s?/, "")}`);
  }
  return lines.length ? glTruncate(lines.join("\n"), GL_MAX_DIFF_CHARS) : "";
}

async function extractGitLab() {
  const host = location.hostname.toLowerCase();
  if (!(host === "gitlab.com" || host.endsWith(".gitlab.com"))) return null;

  const parts = location.pathname.split("/").filter(Boolean);
  const mrIndex = parts.indexOf("merge_requests");
  const issueIndex = parts.indexOf("issues");
  const isMR = mrIndex >= 2 && /^\d+$/.test(parts[mrIndex + 1] || "");
  const isIssue = issueIndex >= 2 && /^\d+$/.test(parts[issueIndex + 1] || "");
  if (!isMR && !isIssue) return null;

  const kind = isMR ? "merge request" : "issue";
  const number = isMR ? parts[mrIndex + 1] : parts[issueIndex + 1];
  const project = parts.slice(0, isMR ? mrIndex - 1 : issueIndex - 1).join("/");
  const title =
    document
      .querySelector('[data-testid="issuable-title"]')
      ?.innerText?.trim() ||
    document.querySelector(".title.page-title, h1")?.innerText?.trim() ||
    document.title;
  const state =
    document
      .querySelector('[data-testid="issuable-state"]')
      ?.innerText?.trim() || "";
  const comments = glComments();

  // GitLab numbers merge requests with `!` and issues with `#`.
  const ref = `${isMR ? "!" : "#"}${number}`;
  let content = `GitLab ${kind} in ${project} (${ref})\n\nTitle: ${title}\n`;
  if (state) content += `State: ${state}\n`;
  if (comments.length) {
    const [first, ...rest] = comments;
    content += `\nDescription${first.author ? ` (by ${first.author})` : ""}:\n${first.text}\n`;
    if (rest.length) {
      content += `\nDiscussion:\n`;
      for (const comment of rest) {
        content += `- ${comment.author ? `${comment.author}: ` : ""}${comment.text}\n`;
      }
    }
  }
  if (isMR) {
    const diff = glDiff();
    content += diff
      ? `\nCode changes (unified diff):\n${diff}\n`
      : `\n(Diff unavailable.)\n`;
  }

  return { type: "gitlab", title, url: location.href, content: content.trim() };
}
