const SO_MAX_ANSWERS = 8;
const SO_MAX_QUESTION_COMMENTS = 8;
const SO_MAX_COMMENTS_PER_ANSWER = 5;
const SO_MAX_ANSWER_CHARS = 4000;
const SO_MAX_COMMENT_CHARS = 500;

const STACKEXCHANGE_HOSTS = [
  "stackoverflow.com",
  "stackexchange.com",
  "superuser.com",
  "serverfault.com",
  "askubuntu.com",
  "mathoverflow.net",
  "stackapps.com",
];

function isStackExchangeHost() {
  const host = location.hostname.toLowerCase();
  return STACKEXCHANGE_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function isStackExchangeQuestionPage() {
  if (!isStackExchangeHost()) return false;
  if (!/^\/questions\/\d+/.test(location.pathname)) return false;
  return Boolean(document.querySelector("#question, .question"));
}

function soScore(root) {
  const vote = root.querySelector(".js-vote-count");
  if (!vote) return undefined;
  const attr = vote.getAttribute("data-value");
  if (attr !== null && attr !== "") {
    const n = parseInt(attr, 10);
    if (!isNaN(n)) return n;
  }
  const n = parseInt(elText(vote), 10);
  return isNaN(n) ? undefined : n;
}

function soAuthor(root) {
  const el =
    root.querySelector(".post-signature.owner .user-details a") ||
    root.querySelector(".user-details a");
  return elAuthor(el);
}

function soBody(root) {
  const el =
    root.querySelector(".js-post-body") ||
    root.querySelector(".s-prose") ||
    root.querySelector(".post-text");
  return elText(el);
}

function soIsAccepted(answerEl) {
  return (
    answerEl.classList.contains("accepted-answer") ||
    answerEl.getAttribute("itemprop") === "acceptedAnswer"
  );
}

function soComments(root) {
  if (!root || (typeof root.isConnected !== "undefined" && !root.isConnected))
    return [];
  const comments = liveEls(root.querySelectorAll?.("li.comment, .comment"));
  return comments.map((el) => ({
    author: elAuthor(el.querySelector?.(".comment-user")),
    text: threadTruncate(
      elText(el.querySelector?.(".comment-copy")),
      SO_MAX_COMMENT_CHARS,
    ),
  }));
}

function soSelectAnswers(answers) {
  const withText = answers.filter((a) => a.text);
  const accepted = withText.filter((a) => a.accepted);
  const rest = withText
    .filter((a) => !a.accepted)
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  return [...accepted, ...rest].slice(0, SO_MAX_ANSWERS);
}

function extractStackOverflow() {
  if (!isStackExchangeQuestionPage()) return null;

  const questionEl =
    document.querySelector("#question") || document.querySelector(".question");
  if (!questionEl) return null;

  const titleEl =
    document.querySelector("#question-header h1 a") ||
    document.querySelector("h1 a.question-hyperlink") ||
    document.querySelector("a.question-hyperlink");
  const title = (elText(titleEl) || document.title).trim();
  const questionText = soBody(questionEl);
  if (!title || !questionText) return null;

  const tags = liveEls(
    questionEl.querySelectorAll(".post-taglist a.post-tag, a.post-tag"),
  )
    .map((t) => elText(t))
    .filter(Boolean);
  const score = soScore(questionEl);
  const author = soAuthor(questionEl);
  const questionComments = soComments(questionEl)
    .filter((c) => c.text)
    .slice(0, SO_MAX_QUESTION_COMMENTS);

  const answerElements = liveEls(
    document.querySelectorAll("#answers .answer, .answer"),
  );

  const answers = soSelectAnswers(
    answerElements.map((el) => ({
      author: soAuthor(el),
      text: threadTruncate(soBody(el), SO_MAX_ANSWER_CHARS),
      score: soScore(el),
      accepted: soIsAccepted(el),
      comments: soComments(el)
        .filter((c) => c.text)
        .slice(0, SO_MAX_COMMENTS_PER_ANSWER),
    })),
  );

  const items = [];
  for (const answer of answers) {
    items.push({
      depth: 0,
      author: answer.author,
      text: answer.text,
      score: answer.score,
      accepted: answer.accepted,
    });
    for (const comment of answer.comments) {
      items.push({
        depth: 1,
        author: comment.author,
        text: comment.text,
      });
    }
  }

  const nodes = buildThreadNodes(items);
  const formatted = selectThreadComments(nodes, (n) => n.text, items.length);

  const meta = [
    typeof score === "number" && `score ${score}`,
    author && `by ${author}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return renderThreadPage({
    label: "Stack Overflow question",
    heading: title,
    title,
    headLines: [tags.length && `Tags: ${tags.join(", ")}`, meta],
    post: questionText,
    afterPost: questionComments.length
      ? `Question comments:\n${questionComments.map((c) => `- ${c.author}: ${c.text}`).join("\n")}`
      : "",
    comments: formatted,
    type: "stackoverflow",
  });
}
