// Bluesky (bsky.app) thread extractor.
//
// bsky.app is a heavy JS-rendered SPA, so DOM scraping from a content
// script is racey. The public AT Protocol endpoint
// https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread returns a
// fully-nested thread for any public post without auth, so we lead with
// that and only fall back to the rendered DOM if the fetch is unavailable
// (offline, CSP-blocked, or the post was removed).

const BLUESKY_MAX_POSTS = 80;
const BLUESKY_MAX_DEPTH = 8;
const BLUESKY_MAX_POST_CHARS = 1500;
const BLUESKY_MAX_SELFTEXT_CHARS = 12000;
const BLUESKY_API_BASE = "https://public.api.bsky.app";
const BLUESKY_API_DEPTH = 10;

const BLUESKY_POST_PATH = /^\/profile\/([^/]+)\/post\/([^/?#]+)/i;

function blueskyFormatAuthor(displayName, handle) {
  const name = (displayName || "").trim();
  const cleanHandle = (handle || "").replace(/^@+/, "").trim();
  if (name && cleanHandle && !name.includes(cleanHandle)) {
    return `${name} (@${cleanHandle})`;
  }
  if (cleanHandle) return `@${cleanHandle}`;
  if (name) return name;
  return "anon";
}

function blueskyPlainText(record) {
  if (!record) return "";
  // Modern records use record.text; older or facet-only records can fall
  // back to a concatenated text-segment walk, but the public API has
  // already resolved that for us in `post.record.text`.
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.textSegments)) {
    return record.textSegments
      .map((s) => (s && typeof s.text === "string" ? s.text : ""))
      .join("");
  }
  return "";
}

function blueskyCollectReplies(replies, depth, items) {
  if (!Array.isArray(replies) || items.length >= BLUESKY_MAX_POSTS) return;
  for (const reply of replies) {
    if (items.length >= BLUESKY_MAX_POSTS) return;
    if (!reply || !reply.post) continue;
    const text = threadTruncate(
      blueskyPlainText(reply.post.record),
      BLUESKY_MAX_POST_CHARS,
    );
    if (!text) continue;
    if (depth >= BLUESKY_MAX_DEPTH) continue;
    const author = blueskyFormatAuthor(
      reply.post.author?.displayName,
      reply.post.author?.handle,
    );
    const likeCount =
      typeof reply.post.likeCount === "number"
        ? reply.post.likeCount
        : undefined;
    // Bluesky has no downvotes; likes map to `score` which renders as
    // `(score: N)` in `formatThreadComments`, not `{downvotes: N}`.
    items.push({ depth, author, text, score: likeCount });
    if (Array.isArray(reply.replies) && reply.replies.length) {
      blueskyCollectReplies(reply.replies, depth + 1, items);
    }
  }
}

function blueskyBuildContent({ opAuthor, opText, opLikes, items }) {
  const nodes = buildThreadNodes(items);
  const eligible = (n) => n.text && n.depth <= BLUESKY_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, BLUESKY_MAX_POSTS);

  let content = `Bluesky discussion\n\nTitle: Post by ${opAuthor}\nAuthor: ${opAuthor}\n`;
  if (typeof opLikes === "number") content += `Engagement: ${opLikes} likes\n`;
  if (opText) content += `\nPost:\n${opText}\n`;

  content += comments.length
    ? `\n${THREAD_COMMENTS_HEADER}\n${formatThreadComments(comments)}\n`
    : `\n(No replies yet.)\n`;

  return content.trim();
}

function blueskyParsePostNode(post) {
  if (!post) return null;
  const text = threadTruncate(
    blueskyPlainText(post.record),
    BLUESKY_MAX_SELFTEXT_CHARS,
    { preserveLines: true },
  );
  if (!text) return null;
  const author = blueskyFormatAuthor(
    post.author?.displayName,
    post.author?.handle,
  );
  const likeCount =
    typeof post.likeCount === "number" ? post.likeCount : undefined;
  return { author, text, likeCount, replies: post.replies };
}

async function extractBluesky() {
  if (!isBlueskyPage()) return null;

  const match = location.pathname.match(BLUESKY_POST_PATH);
  if (!match) return null;
  const [, handleOrDid, rkey] = match;
  const atUri = `at://${handleOrDid}/app.bsky.post.post/${rkey}`;

  const fromApi = await extractBlueskyFromApi(atUri);
  if (fromApi) return fromApi;

  return extractBlueskyFromDom();
}

async function extractBlueskyFromApi(atUri) {
  const url =
    `${BLUESKY_API_BASE}/xrpc/app.bsky.feed.getPostThread` +
    `?uri=${encodeURIComponent(atUri)}` +
    `&depth=${BLUESKY_API_DEPTH}` +
    `&parentHeight=0`;

  let payload;
  try {
    const res = await fetch(url, {
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!res || !res.ok) return null;
    payload = await res.json();
  } catch {
    return null;
  }

  const thread = payload?.thread;
  if (!thread || thread.$type === "app.bsky.feed.defs#blockedPost") return null;
  if (thread.$type === "app.bsky.feed.defs#notFoundPost") return null;

  const op = thread.post ? blueskyParsePostNode(thread.post) : null;
  if (!op) return null;

  const items = [];
  blueskyCollectReplies(thread.replies || [], 0, items);

  const content = blueskyBuildContent({
    opAuthor: op.author,
    opText: op.text,
    opLikes: op.likeCount,
    items,
  });

  return {
    type: "bluesky",
    title: `Bluesky post by ${op.author}`,
    url: location.href,
    content,
  };
}

function extractBlueskyFromDom() {
  if (!isBlueskyPage()) return null;

  const threadRoot = document.querySelector('[data-testid="postThreadItem"]');
  if (!threadRoot) return null;

  // The OP is the first postThreadItem; replies are siblings/descendants
  // beyond it. Bluesky's markup nests replies as additional
  // [data-testid="postThreadItem"] nodes, so we collect them in document
  // order and assign a synthetic depth by counting ancestor postThreadItem
  // containers.
  const postEls = Array.from(
    document.querySelectorAll('[data-testid="postThreadItem"]'),
  );
  if (postEls.length === 0) return null;

  const op = postEls[0];
  const opAuthor = blueskyReadAuthor(op);
  const opText = blueskyReadBody(op);
  if (!opText) return null;

  const items = [];
  for (let i = 1; i < postEls.length; i++) {
    const el = postEls[i];
    const text = blueskyReadBody(el);
    if (!text) continue;
    if (items.length >= BLUESKY_MAX_POSTS) break;
    const depth = blueskyReplyDepth(el, op);
    if (depth > BLUESKY_MAX_DEPTH) continue;
    items.push({
      depth,
      author: blueskyReadAuthor(el),
      text: threadTruncate(text, BLUESKY_MAX_POST_CHARS),
    });
  }

  const content = blueskyBuildContent({
    opAuthor,
    opText,
    opLikes: undefined,
    items,
  });

  return {
    type: "bluesky",
    title: `Bluesky post by ${opAuthor}`,
    url: location.href,
    content,
  };
}

function isBlueskyPage() {
  const host = location.hostname.toLowerCase();
  if (host !== "bsky.app" && host !== "www.bsky.app") return false;
  return BLUESKY_POST_PATH.test(location.pathname);
}

function blueskyReadBody(el) {
  const bodyEl = el.querySelector('[data-testid="richTextText"]');
  if (!bodyEl) return "";
  return (bodyEl.innerText || bodyEl.textContent || "").trim();
}

function blueskyReadAuthor(el) {
  // The display name typically lives in an <a> with a strong inside;
  // the handle sits in a sibling span. We look for the rendered text of
  // the avatar block, splitting on the "@" handle marker when present.
  const nameCandidates = el.querySelectorAll(
    '[data-testid="feedItem-byline"] a, [data-testid="authorDisplayName"]',
  );
  for (const cand of nameCandidates) {
    const text = (cand.innerText || cand.textContent || "").trim();
    if (text) {
      // Strip leading "@" if the selector only returned the handle.
      if (text.startsWith("@")) return text;
      return text;
    }
  }
  // Fall back to the entire byline.
  const byline = el.querySelector('[data-testid="feedItem-byline"]');
  const bylineText = byline
    ? (byline.innerText || byline.textContent || "").trim()
    : "";
  return bylineText || "anon";
}

function blueskyReplyDepth(el, opEl) {
  let depth = 0;
  let p = el.parentElement;
  while (p && p !== opEl && p !== document.body) {
    if (p.matches?.('[data-testid="postThreadItem"]')) depth++;
    p = p.parentElement;
  }
  return depth;
}

true;
