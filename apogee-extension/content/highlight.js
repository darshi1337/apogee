// "Highlight in page": given the original-content chunk a clicked summary
// bullet is most likely grounded in (found via embedding similarity, see
// lib/rag.js's findBestPassage), locate that text in the *live* page and
// scroll to / highlight it. Injected fresh on demand by popup.js each time
// a bullet is clicked (chrome.scripting.executeScript({files, func}), the
// same pull-style pattern content.js's extractors use, not a persistent
// chrome.tabs.sendMessage/onMessage listener, no such convention exists
// elsewhere in this codebase). Re-injected on every click rather than
// version-stamped and reused like the extractors are: each click is a
// one-shot "inject, call once" operation with no meaningful reuse to
// optimize for, so there's nothing to gain from tracking staleness here.
//
// The matching logic below (escapeRegExp/buildFlexibleMatcher/tryMatch/
// splitIntoSpans/findMatchingRange) intentionally mirrors lib/passageMatch.js
// rather than importing it: content scripts here are injected as plain,
// non-module scripts (see content.js's own comment on why), so they can't
// use ES module imports. lib/passageMatch.js stays the canonical,
// unit-tested version; keep this copy in sync with it by hand.

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleMatcher(text) {
  const escaped = escapeRegExp(text.trim()).replace(/\s+/g, "\\s+");
  if (!escaped) return null;
  try {
    return new RegExp(escaped, "i");
  } catch {
    return null;
  }
}

function tryMatch(haystack, text) {
  const re = buildFlexibleMatcher(text);
  if (!re) return null;
  const match = re.exec(haystack);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function splitIntoSpans(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

const PREFIX_WINDOW_CHARS = 180;

function findMatchingRange(pageText, chunkText) {
  const haystack = pageText || "";
  const needle = (chunkText || "").trim();
  if (!haystack || !needle) return null;

  const full = tryMatch(haystack, needle);
  if (full) return full;

  for (const span of splitIntoSpans(needle)) {
    const spanMatch = tryMatch(haystack, span);
    if (spanMatch) return spanMatch;
  }

  const prefix = needle.slice(0, PREFIX_WINDOW_CHARS);
  if (prefix.length < needle.length) {
    return tryMatch(haystack, prefix);
  }
  return null;
}

// Walks the page's visible text nodes once, building one big concatenated
// string plus a parallel list of { node, start, end } records mapping each
// node's own span within that string, so a character offset found by
// findMatchingRange above can be mapped back onto real DOM nodes/Ranges.
function buildTextIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
        return NodeFilter.FILTER_REJECT;
      }
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let text = "";
  const records = [];
  let node;
  while ((node = walker.nextNode())) {
    const value = node.nodeValue || "";
    if (!value) continue;
    records.push({
      node,
      start: text.length,
      end: text.length + value.length,
    });
    text += value;
  }
  return { text, records };
}

// Maps a { start, end } character range (into buildTextIndex's concatenated
// text) onto a DOM Range spanning the text node(s) it actually falls
// within (a match can span more than one node, e.g. text broken up by an
// inline <em>/<a>/<span> in the middle of a sentence).
function rangeFromOffsets(records, start, end) {
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  for (const record of records) {
    if (startNode === null && start >= record.start && start < record.end) {
      startNode = record.node;
      startOffset = start - record.start;
    }
    if (end > record.start && end <= record.end) {
      endNode = record.node;
      endOffset = end - record.start;
      break;
    }
  }
  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

const APOGEE_HIGHLIGHT_NAME = "apogee-grounding";

// Entry point, called directly via chrome.scripting.executeScript's `func`
// option (see popup.js), not through any message-passing. Returns
// { found, highlighted } rather than throwing, so a miss (the passage
// isn't actually findable on the live page, e.g. it changed since
// extraction, or diverges too much from Readability's extracted text) is
// something the caller can show a normal "couldn't locate it" state for,
// not treat as a hard error.
window.__apogeeHighlight = function (chunkText) {
  try {
    const { text, records } = buildTextIndex(document.body);
    const match = findMatchingRange(text, chunkText);
    if (!match) return { found: false, highlighted: false };

    const range = rangeFromOffsets(records, match.start, match.end);
    if (!range) return { found: false, highlighted: false };

    const scrollTarget = range.startContainer.parentElement || document.body;

    // CSS Custom Highlight API (Chrome 105+, Firefox 140+): highlights the
    // range without mutating the page's DOM at all, unlike wrapping it in a
    // <mark>, which a React/Vue-managed page can revert on its next render,
    // and which range.surroundContents() can't do anyway for a range that
    // spans more than one element without manually splitting it node by
    // node. Falls back to scroll-only (no visual highlight) if unsupported.
    let highlighted = false;
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete(APOGEE_HIGHLIGHT_NAME);
      CSS.highlights.set(APOGEE_HIGHLIGHT_NAME, new Highlight(range));
      highlighted = true;
    }

    scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
    return { found: true, highlighted };
  } catch (err) {
    console.error("Apogee highlight failed:", err);
    return { found: false, highlighted: false };
  }
};

// See content.js's identical comment: Firefox structured-clones the last
// evaluated expression when injecting via files, and the assignment above
// evaluates to a Function, which isn't clonable.
true;
