// SHARED WITH lib/retrieval/passageMatch.js - keep in sync
//
// This file is injected as a plain content script and cannot import anything, so the block below is duplicated in lib/retrieval/passageMatch.js, which is what the tests import. This copy is the one that actually runs. A test in tests/retrieval/passageMatch.test.js fails if the two drift apart.
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_MATCH_TEXT_CHARS = 1500;

function buildFlexibleMatcher(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_MATCH_TEXT_CHARS) return null;
  const escaped = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
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
// END SHARED

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

function ensureShadowOverlayHost() {
  if (typeof document === "undefined" || !document.body) return null;
  let host = document.getElementById("apogee-highlight-root");
  if (!host) {
    host = document.createElement("apogee-highlight-root");
    host.id = "apogee-highlight-root";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: absolute;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        pointer-events: none;
        z-index: 2147483647;
      }
      .apogee-overlay-container {
        position: absolute;
        pointer-events: none;
      }
    `;
    shadow.appendChild(style);
    document.body.appendChild(host);
  }
  return host.shadowRoot;
}

function performHighlight(chunkText) {
  try {
    ensureShadowOverlayHost();
    const { text, records } = buildTextIndex(document.body);
    const match = findMatchingRange(text, chunkText);
    if (!match) return { found: false, highlighted: false };

    const range = rangeFromOffsets(records, match.start, match.end);
    if (!range) return { found: false, highlighted: false };

    const scrollTarget = range.startContainer.parentElement || document.body;

    let highlighted = false;
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete(APOGEE_HIGHLIGHT_NAME);
      CSS.highlights.set(APOGEE_HIGHLIGHT_NAME, new Highlight(range));
      highlighted = true;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    scrollTarget.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "center",
    });
    return { found: true, highlighted };
  } catch (err) {
    console.error("Apogee highlight failed:", err);
    return { found: false, highlighted: false };
  }
}

if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id && sender.id !== chrome.runtime.id) return;
    if (message && message.action === "apogee-highlight") {
      const result = performHighlight(message.chunkText);
      sendResponse(result);
      return true;
    }
  });
}

true;
