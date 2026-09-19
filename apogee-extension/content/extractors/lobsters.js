const LOBSTERS_MAX_COMMENTS = 80;
const LOBSTERS_MAX_DEPTH = 8;
const LOBSTERS_MAX_COMMENT_CHARS = 1500;

function lobstersCommentDepth(li) {
  for (const cls of li.classList) {
    if (cls.startsWith("indent_")) {
      const num = parseInt(cls.slice(7), 10);
      if (!isNaN(num)) return num;
    }
  }
  const attr = li.getAttribute("data-indent");
  if (attr !== null) return parseInt(attr, 10) || 0;
  let depth = 0;
  let parent = li.parentElement;
  while (parent) {
    if (parent.tagName === "OL" && parent.classList.contains("comments")) {
      depth++;
    }
    parent = parent.parentElement;
  }
  return Math.max(0, depth - 1);
}

function lobstersCommentItems(commentElements) {
  return liveEls(commentElements).map((li) => {
    const bodyEl = li.querySelector?.(".comment_text");
    const authorEl = li.querySelector?.(".byline a.u-author, .byline a.user");
    const scoreEl = li.querySelector?.(".score");
    const scoreText = elText(scoreEl);
    const scoreVal = scoreText ? parseInt(scoreText, 10) : NaN;

    return {
      depth: lobstersCommentDepth(li),
      author: elAuthor(authorEl),
      text: bodyEl
        ? threadTruncate(elText(bodyEl), LOBSTERS_MAX_COMMENT_CHARS)
        : "",
      score: isNaN(scoreVal) ? undefined : scoreVal,
    };
  });
}

function extractLobsters() {
  if (!location.pathname.startsWith("/s/")) return null;

  const story = document.querySelector(".story, .h-entry, #inside");
  if (!story && !document.querySelector("ol.comments, .comments")) return null;

  const titleEl =
    document.querySelector(".story_title a") ||
    document.querySelector(".u-url") ||
    document.querySelector("h1");
  const title = (
    titleEl?.innerText ||
    titleEl?.textContent ||
    document.title
  ).trim();

  const linkHref = titleEl?.getAttribute("href") || "";
  const isExternalLink =
    /^https?:/i.test(linkHref) && !linkHref.includes("lobste.rs");
  const domain = elText(document.querySelector(".domain"));

  const points = elText(document.querySelector(".story .score"));
  const author = elText(document.querySelector(".story .byline a.u-author"));

  const storyText = elText(document.querySelector(".story_text"));

  const commentLis = liveEls(
    document.querySelectorAll("ol.comments > li.comment, li.comment"),
  );
  const nodes = buildThreadNodes(lobstersCommentItems(commentLis));
  const eligible = (n) => n.text && n.depth <= LOBSTERS_MAX_DEPTH;
  const comments = selectThreadComments(nodes, eligible, LOBSTERS_MAX_COMMENTS);

  const meta = [points && `${points} points`, author && `by ${author}`]
    .filter(Boolean)
    .join(" | ");

  return renderThreadPage({
    label: "Lobste.rs discussion",
    heading: title,
    title,
    headLines: [isExternalLink && `Links to: ${domain || linkHref}`, meta],
    post: storyText,
    comments,
    type: "lobsters",
  });
}
