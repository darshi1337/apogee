// The passage matcher lives in lib/retrieval/passageMatch.js and is bundled
// into this content script by Vite (see vite.config.js), so there is a single
// source of truth instead of a duplicated block.
import { findMatchingRange } from "../lib/retrieval/passageMatch.js";

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
    if (sender?.id !== chrome.runtime.id) return;
    // Highlight requests come from the extension page via tabs.sendMessage
    // (no sender tab); tab-hosted contexts must not trigger page highlights.
    if (sender.tab) return;
    if (message && message.action === "apogee-highlight") {
      const result = performHighlight(message.chunkText);
      sendResponse(result);
      return true;
    }
  });
}

true;
