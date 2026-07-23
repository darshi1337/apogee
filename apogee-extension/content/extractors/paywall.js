// Heuristic paywall detector, run against the live DOM right after
// Readability parses the page (see generic.js). No network calls here -
// purely local signal used to decide whether it's worth trying the (opt-in,
// see settings.archiveFallback) Wayback Machine fallback in
// lib/pageExtraction.js.

// Selectors used by common paywall vendors/CMSes. A hit here is decisive on
// its own: these only ever appear when a wall is actually shown, unlike
// text phrases which also show up in unrelated marketing copy.
const PAYWALL_SELECTORS = [
  '[class*="paywall" i]',
  '[id*="paywall" i]',
  ".piano-inline",
  ".tp-modal",
  ".tp-backdrop",
  ".piano-offer",
  'meta[property="article:content_tier"][content="locked" i]',
];

// Wording pulled from a wall/registration/checkout box, not from ordinary
// article or marketing copy - a real free article body essentially never
// contains "one-time payment" or "add your email address" as prose, so a
// match here is decisive on its own, same as a selector hit. (Confirmed
// against a live washingtonpost.com paywall, which uses several of these -
// an earlier version of this list required pairing a phrase hit with short
// extracted content, which missed that case: "already a subscriber? log
// in" didn't match WaPo's actual "Already a subscriber? Sign in", and the
// short-content pairing would've missed it anyway since WaPo's teaser text
// alone can run past that threshold.)
const PAYWALL_PHRASES = [
  "subscribe to continue reading",
  "subscribe to read",
  "subscribers only",
  "this article is for subscribers",
  "create a free account to continue reading",
  "you have reached your free article limit",
  "already a subscriber?",
  "to continue reading this article",
  "get access your way",
  "one-time payment",
  "unlimited access on the web and in our apps",
];

function detectPaywall(doc) {
  if (PAYWALL_SELECTORS.some((sel) => doc.querySelector(sel))) return true;

  const bodyText = (doc.body?.innerText || "").toLowerCase();
  return PAYWALL_PHRASES.some((phrase) => bodyText.includes(phrase));
}

window.detectPaywall = detectPaywall;

// See content.js's comment on the same pattern: Firefox structured-clones
// the last evaluated expression when injected via executeScript({ files }),
// and a Function isn't clonable.
true;
