const LEMMY_MAX_COMMENTS = 80;
const LEMMY_MAX_DEPTH = 8;
const LEMMY_MAX_COMMENT_CHARS = 1500;

function isLemmyPage() {
  const path = location.pathname;
  const isLemmyUrl =
    /^\/post\/\d+/i.test(path) || /^\/comment\/\d+/i.test(path);

  const hasLemmyMeta = Boolean(
    document.querySelector('meta[name="generator"][content*="Lemmy" i]') ||
    document.querySelector('meta[property="og:site_name"][content*="Lemmy" i]'),
  );

  const hasLemmyDom = Boolean(
    document.querySelector(
      ".post-listing, #post, .comment-node, [data-test='post-title'], .post-title",
    ),
  );

  return isLemmyUrl || (hasLemmyMeta && hasLemmyDom);
}

function lemmyCommentDepth(el, rootEl) {
  const indentAttr =
    el.getAttribute("data-depth") || el.getAttribute("data-indent");
  if (indentAttr !== null) {
    const parsed = parseInt(indentAttr, 10);
    if (!isNaN(parsed)) return parsed;
  }

  let depth = 0;
  let p = el.parentElement;
  while (p && p !== rootEl && p !== document.body) {
    if (
      p.classList.contains("comment-node") ||
      p.classList.contains("comment") ||
      p.classList.contains("comments-tree") ||
      p.tagName === "LI"
    ) {
      depth++;
    }
    p = p.parentElement;
  }
  return Math.max(0, depth - 1);
}

function lemmyCommentItems(commentElements, mainPostEl) {
  return Array.from(commentElements, (el) => {
    const authorEl = el.querySelector(
      "[data-test='comment-author'], .person-name, a.person-name, .comment-author, .author",
    );
    const bodyEl = el.querySelector(
      "[data-test='comment-body'], .comment-content, .markdown-content, .comment-body, .e-content",
    );
    const scoreEl = el.querySelector(
      "[data-test='comment-score'], .comment-score, .vote-count, .score",
    );

    const authorName = elAuthor(authorEl);
    const rawText = elText(bodyEl);

    const scoreText = elText(scoreEl);
    const parsedScore = parseInt(scoreText.replace(/[^0-9-]/g, ""), 10);
    const score = isNaN(parsedScore) ? undefined : parsedScore;

    return {
      depth: lemmyCommentDepth(el, mainPostEl?.parentElement || document.body),
      author: authorName,
      text: threadTruncate(rawText, LEMMY_MAX_COMMENT_CHARS),
      score,
    };
  });
}

function extractLemmy() {
  if (!isLemmyPage()) return null;

  const path = location.pathname;
  if (
    (/^\/c\//i.test(path) && !/^\/post\//i.test(path)) ||
    /^\/u\//i.test(path) ||
    /^\/communities/i.test(path) ||
    /^\/search/i.test(path)
  ) {
    return null;
  }

  const mainPost =
    document.querySelector(
      "[data-test='post-container'], #post, .post-listing, article.post",
    ) ||
    document.querySelector(".post-title")?.closest("div, article, section");

  const titleEl = document.querySelector(
    "[data-test='post-title'], h1.post-title, .post-title, #post h1, h1",
  );
  const titleText = elText(titleEl);

  if (!titleText) return null;

  const authorEl = mainPost?.querySelector(
    "[data-test='post-author'], .person-name, a.person-name, .post-meta .author, .author",
  );
  const authorName = elAuthor(authorEl);

  const communityEl = mainPost?.querySelector(
    "[data-test='post-community'], .community-name, a.community-name, .post-meta .community",
  );
  const communityName = elText(communityEl);

  const bodyEl = mainPost?.querySelector(
    "[data-test='post-body'], .post-body, .post-content, #post .markdown-content, .markdown-content",
  );
  const postText = elText(bodyEl);

  const scoreEl = mainPost?.querySelector(
    "[data-test='post-score'], .post-meta .score, .vote-count, .score",
  );
  const scoreText = elText(scoreEl);

  const linkEl = mainPost?.querySelector(
    "[data-test='post-link'], a.post-title-link, .post-link",
  );
  const externalUrl = linkEl?.getAttribute("href") || "";

  let candidateComments = Array.from(
    document.querySelectorAll(".comment-node"),
  );
  if (candidateComments.length === 0) {
    candidateComments = Array.from(
      document.querySelectorAll(".comment, div.comment, article.comment"),
    );
  }

  const commentElements = liveEls(candidateComments).filter(
    (el) =>
      !(mainPost && (el === mainPost || (mainPost?.contains?.(el) ?? false))),
  );

  const nodes = buildThreadNodes(lemmyCommentItems(commentElements, mainPost));
  const eligible = (n) => n.text && n.depth <= LEMMY_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, LEMMY_MAX_COMMENTS);

  return renderThreadPage({
    label: "Lemmy post",
    heading: titleText,
    title: `Lemmy: ${titleText}`,
    headLines: [
      `Author: ${authorName}`,
      communityName && `Community: ${communityName}`,
      scoreText && `Score: ${scoreText}`,
      externalUrl && `Link: ${externalUrl}`,
    ],
    post: postText,
    comments,
    type: "lemmy",
  });
}

true;
