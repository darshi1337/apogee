// Visible text with a parser-safe fallback: innerText is undefined on SVG
// elements and in some test DOMs, where textContent still applies. Each side
// is trimmed before falling through, matching the pattern every extractor
// already used: whitespace-only innerText still yields to textContent.
function elText(el) {
  return el?.innerText?.trim() || el?.textContent?.trim() || "";
}

function elAuthor(el) {
  return elText(el) || "anon";
}

// Detached nodes (ads being swapped out mid-read) must not enter the tree.
function liveEls(list) {
  return Array.from(list || []).filter(
    (el) => el && (typeof el.isConnected === "undefined" || el.isConnected),
  );
}

// Shared discussion-page render: label + title line, caller-ordered header
// lines (sites disagree on Links-to vs meta ordering), optional post, an
// optional extra section between post and comments (Stack Overflow's question
// comments), then the comment tree or the empty note. heading is the Title:
// line while title is the returned page title (they differ on Discourse).
function renderThreadPage({
  label,
  heading,
  title,
  headLines = [],
  post = "",
  afterPost = "",
  comments = [],
  type,
  emptyNote = "(No comments yet.)",
}) {
  let content = `${label}\n\nTitle: ${heading}\n`;
  for (const line of headLines) if (line) content += `${line}\n`;
  if (post) content += `\nPost:\n${post}\n`;
  if (afterPost) content += `\n${afterPost}\n`;
  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n${emptyNote}\n`;
  return { type, title, url: location.href, content: content.trim() };
}

// Line-preserving truncation shared by the forge (GitHub/GitLab) extractors
// for comments, diffs, and readmes alike.
function truncateKeepLines(text, max) {
  return threadTruncate(text, max, { preserveLines: true });
}

// Shared deduped comment collector for the forge extractors: skip detached
// nodes, drop empties and repeats, truncate, stop at the cap. Sites differ
// only in how blocks are found and where body/author live inside a block.
function collectForgeComments(
  blocks,
  { maxComments, maxChars, getBodyText, getAuthor },
) {
  const out = [];
  const seen = new Set();
  for (const block of liveEls(blocks)) {
    if (out.length >= maxComments) break;
    const text = getBodyText(block);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({
      author: getAuthor(block),
      text: truncateKeepLines(text, maxChars),
    });
  }
  return out;
}

// Shared issue/PR/MR page render: title + state, first comment as the
// description, the rest under a site-named header, then the diff section.
// diff === null (repo pages, plain issues on some hosts) omits it entirely.
function renderForgePage({
  label,
  title,
  state = "",
  comments = [],
  commentsHeader = "Comments",
  diff = null,
  type,
}) {
  let content = `${label}\n\nTitle: ${title}\n`;
  if (state) content += `State: ${state}\n`;
  if (comments.length) {
    const [first, ...rest] = comments;
    content += `\nDescription${first.author ? ` (by ${first.author})` : ""}:\n${first.text}\n`;
    if (rest.length) {
      content += `\n${commentsHeader}:\n`;
      for (const c of rest) {
        content += `- ${c.author ? `${c.author}: ` : ""}${c.text}\n`;
      }
    }
  }
  if (diff !== null) {
    content += diff
      ? `\nCode changes (unified diff):\n${diff}\n`
      : `\n(Diff unavailable.)\n`;
  }
  return { type, title, url: location.href, content: content.trim() };
}

function threadTruncate(text, max, { preserveLines = false } = {}) {
  const collapsed = preserveLines
    ? (text || "").replace(/[ \t]+\n/g, "\n")
    : (text || "").replace(/\s+/g, " ");
  const t = collapsed.trim();
  return t.length > max ? `${t.slice(0, max).trim()}…` : t;
}

function buildThreadNodes(items) {
  const counters = [];
  const parents = [];

  for (const node of items) {
    const depth = node.depth;
    counters[depth] = (counters[depth] || 0) + 1;
    counters.length = depth + 1;
    parents.length = depth;

    node.parent = parents[depth - 1] || null;
    node.path = counters.join(".");
    node.directReplies = 0;
    node.subtreeSize = 0;
    if (node.parent) node.parent.directReplies++;
    parents[depth] = node;
  }

  for (const node of items) {
    for (let p = node.parent; p; p = p.parent) p.subtreeSize++;
  }
  return items;
}

function selectThreadComments(nodes, eligible, maxComments) {
  for (const node of nodes) node.directReplies = 0;
  for (const node of nodes) {
    if (eligible(node) && node.parent) node.parent.directReplies++;
  }

  const survivors = nodes.filter(eligible);
  if (survivors.length <= maxComments) return survivors;

  const ranked = [...survivors].sort(
    (a, b) => b.subtreeSize - a.subtreeSize || a.depth - b.depth,
  );
  const keep = new Set(ranked.slice(0, maxComments));
  for (const n of [...keep]) {
    for (let p = n.parent; p; p = p.parent) keep.add(p);
  }
  return nodes.filter((n) => keep.has(n) && eligible(n));
}

const THREAD_COMMENTS_HEADER =
  "Comments (path [n.n] shows the reply tree; <replies> = direct replies; {downvotes}/(score) are engagement signals):";

function formatThreadComments(nodes) {
  const lines = [];
  for (const n of nodes) {
    let line = `[${n.path}]`;
    if (n.directReplies) line += ` <replies: ${n.directReplies}>`;
    if (n.downvotes) line += ` {downvotes: ${n.downvotes}}`;
    if (typeof n.score === "number") line += ` (score: ${n.score})`;
    if (n.accepted) line += ` [accepted]`;
    line += ` ${n.author}: ${n.text}`;
    lines.push(line);
  }
  return lines.join("\n");
}
