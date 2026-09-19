const DISCOURSE_MAX_POSTS = 80;
const DISCOURSE_MAX_POST_CHARS = 1500;

function isDiscoursePage() {
  const path = location.pathname;
  const isDiscourseUrl =
    /^\/t\/[^/]+\/\d+/i.test(path) || /^\/t\/\d+/i.test(path);

  const hasDiscourseMeta = Boolean(
    document.querySelector('meta[name="generator"][content*="Discourse" i]') ||
    document.querySelector(
      'meta[property="og:site_name"][content*="Discourse" i]',
    ),
  );

  const hasDiscourseDom = Boolean(
    document.querySelector(
      "#main-outlet, .topic-post, .post-stream, #topic-title",
    ),
  );

  return isDiscourseUrl || (hasDiscourseMeta && hasDiscourseDom);
}

function extractDiscourse() {
  if (!isDiscoursePage()) return null;

  const path = location.pathname;
  if (
    /^\/c\//i.test(path) ||
    /^\/tag\//i.test(path) ||
    /^\/u\//i.test(path) ||
    /^\/latest/i.test(path) ||
    /^\/top/i.test(path) ||
    /^\/unread/i.test(path) ||
    /^\/categories/i.test(path) ||
    /^\/search/i.test(path)
  ) {
    return null;
  }

  const titleEl = document.querySelector(
    "a.fancy-title, .fancy-title, #topic-title h1 a, #topic-title h1",
  );
  const titleText = elText(titleEl);

  if (!titleText) return null;

  const categoryEl = document.querySelector(".topic-category, .badge-wrapper");
  const categoryText = elText(categoryEl);

  const postElements = liveEls(
    document.querySelectorAll(
      ".post-stream .topic-post, #main-outlet .topic-post, article.boxed, div[id^='post_']",
    ),
  );

  if (postElements.length === 0) return null;

  const opEl = postElements[0];
  const opAuthorEl = opEl?.querySelector?.(
    ".username, .names .username, [itemprop='author'], .creator",
  );
  const opAuthor = elAuthor(opAuthorEl);

  const opBodyEl = opEl?.querySelector?.(".cooked, .post-body, .topic-body");
  const opText = elText(opBodyEl);

  const replyElements = postElements.slice(1);

  const commentItems = liveEls(replyElements).map((el) => {
    const authorEl = el.querySelector?.(
      ".username, .names .username, [itemprop='author'], .creator",
    );
    const bodyEl = el.querySelector?.(".cooked, .post-body, .topic-body");
    const likesEl = el.querySelector?.(
      ".like-count, .post-retort, .actions .likes",
    );

    const authorName = elAuthor(authorEl);
    const rawText = elText(bodyEl);

    const likesText = elText(likesEl);
    const parsedScore = parseInt(likesText.replace(/[^0-9-]/g, ""), 10);
    const score = isNaN(parsedScore) ? undefined : parsedScore;

    return {
      depth: 0,
      author: authorName,
      text: threadTruncate(rawText, DISCOURSE_MAX_POST_CHARS),
      score,
    };
  });

  const nodes = buildThreadNodes(commentItems);
  const eligible = (n) => n.text;
  const comments = selectThreadComments(nodes, eligible, DISCOURSE_MAX_POSTS);

  return renderThreadPage({
    label: "Discourse topic",
    heading: titleText,
    title: `Discourse: ${titleText}`,
    headLines: [
      `Author: ${opAuthor}`,
      categoryText && `Category: ${categoryText}`,
    ],
    post: opText,
    comments,
    type: "discourse",
    emptyNote: "(No replies yet.)",
  });
}

true;
