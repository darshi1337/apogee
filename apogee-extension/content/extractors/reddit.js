// Reddit comments-page extractor.
//
// Fetches the thread JSON for the page already open (`${location.origin}${location.pathname}.json`,
// same origin as the viewed comments page) from the content script (the page's
// own context), so no extra host permission or extension-pages connect-src
// entry applies: the request cannot reach any host other than the Reddit page
// itself. Sent with credentials omitted and an explicit JSON accept, carrying
// no page content beyond the URL already viewed. Documented in PRIVACY.md
// ("Outbound Network Connection Details") alongside the YouTube page-context
// fetch rationale.
const REDDIT_MAX_COMMENTS = 60;
const REDDIT_MAX_DEPTH = 8;
const REDDIT_MAX_COMMENT_CHARS = 1500;
const REDDIT_MAX_SELFTEXT_CHARS = 12000;

function redditCollectItems(children, depth, items) {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (!child || child.kind !== "t1" || !child.data) continue;
    const c = child.data;
    const body = (c.body || "").trim();
    const dead = !body || body === "[deleted]" || body === "[removed]";
    items.push({
      depth,
      author: c.author || "anon",
      score: typeof c.score === "number" ? c.score : undefined,
      text: dead ? "" : threadTruncate(body, REDDIT_MAX_COMMENT_CHARS),
    });
    if (depth < REDDIT_MAX_DEPTH && c.replies && c.replies.data) {
      redditCollectItems(c.replies.data.children, depth + 1, items);
    }
  }
}

async function extractReddit() {
  if (!/\/comments\//.test(location.pathname)) return null;

  const base = `${location.origin}${location.pathname.replace(/\/+$/, "")}`;
  const jsonUrl = `${base}.json?raw_json=1&limit=200&depth=${REDDIT_MAX_DEPTH}&sort=top`;

  let data;
  try {
    const res = await fetch(jsonUrl, {
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) return null;

  const title = (post.title || document.title).trim();
  const subreddit = post.subreddit_name_prefixed || "";
  const author = post.author ? `u/${post.author}` : "";
  const score = typeof post.score === "number" ? `${post.score} points` : "";
  const numComments =
    typeof post.num_comments === "number"
      ? `${post.num_comments} comments`
      : "";
  const flair = post.link_flair_text ? `[${post.link_flair_text}]` : "";
  const selftext = threadTruncate(
    post.selftext || "",
    REDDIT_MAX_SELFTEXT_CHARS,
    {
      preserveLines: true,
    },
  );
  const externalUrl = post.is_self ? "" : post.url || "";

  const items = [];
  redditCollectItems(data?.[1]?.data?.children, 0, items);
  const nodes = buildThreadNodes(items);
  const eligible = (n) => n.text && n.depth <= REDDIT_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, REDDIT_MAX_COMMENTS);

  let content = `Reddit discussion\n\nTitle: ${title}\n`;
  const meta = [subreddit, author, score, numComments, flair]
    .filter(Boolean)
    .join(" | ");
  if (meta) content += `${meta}\n`;
  if (externalUrl) content += `Links to: ${externalUrl}\n`;
  if (selftext) content += `\nPost:\n${selftext}\n`;

  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n(No comments yet.)\n`;

  return {
    type: "reddit",
    title,
    url: location.href,
    content: content.trim(),
  };
}
