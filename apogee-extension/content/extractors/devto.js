const DEVTO_MAX_COMMENTS = 80;
const DEVTO_MAX_DEPTH = 8;
const DEVTO_MAX_COMMENT_CHARS = 1500;

const DEVTO_NON_ARTICLE_PATHS = [
  /^\/$/,
  /^\/top/,
  /^\/latest/,
  /^\/t\//,
  /^\/tags?\//,
  /^\/search/,
  /^\/settings/,
  /^\/new/,
  /^\/listings/,
  /^\/pod/,
  /^\/videos?/,
];

function devtoText(el) {
  if (!el) return "";
  return (el.innerText || el.textContent || "").trim();
}

function isDevtoHost() {
  const host = location.hostname.toLowerCase();
  return host === "dev.to" || host.endsWith(".dev.to");
}

function devtoCommentDepth(node) {
  for (const cls of node.classList || []) {
    const m = /^comment--deep-(\d+)$/.exec(cls);
    if (m) return parseInt(m[1], 10);
  }
  const attr =
    node.getAttribute("data-comment-depth") || node.getAttribute("data-depth");
  if (attr !== null && attr !== "") {
    const n = parseInt(attr, 10);
    if (!isNaN(n)) return n;
  }
  let depth = 0;
  let parent = node.parentElement;
  while (parent) {
    if (parent.classList?.contains("single-comment-node")) depth++;
    parent = parent.parentElement;
  }
  return depth;
}

function devtoCommentItems(nodes) {
  return Array.from(nodes)
    .filter(
      (el) => el && (typeof el.isConnected === "undefined" || el.isConnected),
    )
    .map((el) => {
      const bodyEl = el.querySelector?.(".comment__body");
      const authorEl =
        el.querySelector?.(".js-comment-username") ||
        el.querySelector?.(".comment__header a");
      return {
        depth: devtoCommentDepth(el),
        author: devtoText(authorEl) || "anon",
        text: bodyEl
          ? threadTruncate(devtoText(bodyEl), DEVTO_MAX_COMMENT_CHARS)
          : "",
      };
    });
}

function extractDevto() {
  if (!isDevtoHost()) return null;
  if (DEVTO_NON_ARTICLE_PATHS.some((re) => re.test(location.pathname)))
    return null;

  const bodyEl = document.querySelector("#article-body");
  if (!bodyEl) return null;

  const titleEl =
    document.querySelector("#main-title h1") ||
    document.querySelector("h1.fs-3xl");
  const title = devtoText(titleEl) || document.title.trim();
  const body = devtoText(bodyEl);
  if (!title || !body) return null;

  const authorEl =
    document.querySelector(
      "#main-title .crayons-article__header__meta a.crayons-link",
    ) || document.querySelector(".crayons-article__header__meta a[href^='/']");
  const author = devtoText(authorEl) || "anon";

  const dateEl = document.querySelector(
    "#main-title time, .crayons-article__header__meta time",
  );
  const date = dateEl?.getAttribute("datetime") || devtoText(dateEl);

  const tags = Array.from(
    document.querySelectorAll(
      "#main-title .crayons-tag, .crayons-article__header .crayons-tag",
    ),
  )
    .map((t) => devtoText(t).replace(/^#/, ""))
    .filter(Boolean);

  const commentNodes = document.querySelectorAll(
    "#comment-trees-container .single-comment-node, #comments .single-comment-node",
  );
  const nodes = buildThreadNodes(devtoCommentItems(commentNodes));
  const eligible = (n) => n.text && n.depth <= DEVTO_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, DEVTO_MAX_COMMENTS);

  let content = `DEV Community article\n\nTitle: ${title}\nAuthor: ${author}\n`;
  if (date) content += `Posted: ${date}\n`;
  if (tags.length) content += `Tags: ${tags.join(", ")}\n`;
  content += `\nPost:\n${body}\n`;

  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n(No comments yet.)\n`;

  return {
    type: "devto",
    title,
    url: location.href,
    content: content.trim(),
  };
}
