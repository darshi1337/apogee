/**
 * Minimal Markdown-to-HTML renderer for model output and cached summaries.
 *
 * Security model: model output and cached summaries are untrusted input
 * (a poisoned cache or model quirk must never become stored XSS). The
 * renderer escapes everything first and only re-introduces a small allow-list
 * of formatting tags (p, h1-h6, ul, ol, li, strong, em, code, a). A final
 * allow-list sanitizer pass makes that guarantee fail-closed: even if a
 * formatting regex ever misfires, unexpected tags/attributes are escaped
 * instead of sunk into innerHTML.
 */

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LINK_PLACEHOLDER_MARK = "";

export const ALWAYS_LINKIFY_HOSTS = new Set(["youtube.com", "bilibili.com"]);

let linkifyPageHost = null;

export function getLinkifyPageHost() {
  return linkifyPageHost;
}

export function setLinkifyPageHostForTests(host) {
  linkifyPageHost = host;
}

export function normalizeLinkHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^(www\.|m\.)/, "");
  return h === "youtu.be" ? "youtube.com" : h;
}

export function setLinkifyOriginFromUrl(url) {
  try {
    linkifyPageHost = normalizeLinkHost(new URL(url).hostname);
  } catch {
    linkifyPageHost = null;
  }
}

export function isLinkifiableHref(href) {
  let host;
  try {
    host = normalizeLinkHost(new URL(href).hostname);
  } catch {
    return false;
  }
  return host === linkifyPageHost || ALWAYS_LINKIFY_HOSTS.has(host);
}

/**
 * Reject hrefs that could break out of the href="..." attribute or use a
 * dangerous scheme. `href` here is the escaped-form match (entities intact),
 * so a literal quote would appear as &quot; — reject those outright and only
 * accept http(s) URLs with no whitespace or angle brackets.
 */
export function isSafeMarkdownHref(href) {
  if (!href || typeof href !== "string") return false;
  if (/[\s<>"']/.test(href)) return false;
  if (/&(lt|gt|quot);|&#39;|&#x27;/i.test(href)) return false;
  let decoded = href.replace(/&amp;/g, "&");
  if (/[\s<>"']/.test(decoded)) return false;
  let parsed;
  try {
    parsed = new URL(decoded);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return true;
}

export function extractMarkdownLinks(escapedText) {
  const links = [];
  const text = escapedText.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (match, label, href) => {
      if (!isSafeMarkdownHref(href) || !isLinkifiableHref(href)) return label;
      links.push(
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`,
      );
      return `${LINK_PLACEHOLDER_MARK}${links.length - 1}${LINK_PLACEHOLDER_MARK}`;
    },
  );
  return { text, links };
}

export function renderInline(escapedText) {
  const { text, links } = extractMarkdownLinks(escapedText);
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>")
    .replace(/\uE000(\d+)\uE000/g, (match, i) => links[Number(i)] ?? match);
}

const ALLOWED_MARKDOWN_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "code",
  "a",
]);

function sanitizeAnchorAttributes(attrString) {
  const hrefMatch = attrString.match(/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
  if (!hrefMatch) return null;
  let href = hrefMatch[1].trim();
  const quote = href[0];
  if ((quote === '"' || quote === "'") && href.endsWith(quote)) {
    href = href.slice(1, -1);
  }
  // The renderer emits escaped hrefs (quotes as &quot;). A raw quote here
  // means the tag did not come from the renderer — drop the link.
  if (!isSafeMarkdownHref(href)) return null;
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
}

/**
 * Fail-closed allow-list sanitizer for renderer output. Only the formatting
 * tags the renderer emits survive; everything else (including event-handler
 * attributes, javascript: hrefs, and unknown elements) is escaped to text.
 * Pure string processing so it works in extension pages and in node tests.
 */
export function sanitizeMarkdownHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html.replace(
    /<(\/?)([A-Za-z][A-Za-z0-9]*)\b([^<>]*)>/g,
    (match, closing, rawTag, attrs) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_MARKDOWN_TAGS.has(tag)) {
        return escapeHtml(match);
      }
      if (closing) return `</${tag}>`;
      if (tag === "a") {
        const anchor = sanitizeAnchorAttributes(attrs || "");
        return anchor ?? escapeHtml(match);
      }
      return `<${tag}>`;
    },
  );
}

export function renderMarkdown(source) {
  // Strip private-use placeholder marks from user input so model/cached text
  // cannot inject link placeholders that the restore pass would expand.
  const lines = escapeHtml(source ?? "")
    .replace(/\uE000/g, "")
    .split(/\r?\n/);
  let html = "";
  let listType = null;
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      html += `<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`;
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${renderInline(bullet[1])}</li>`;
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${renderInline(ordered[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${renderInline(line)}</p>`;
  }
  closeList();
  return sanitizeMarkdownHtml(html);
}

export function renderStoredSummaryMarkdown(text) {
  const savedHost = linkifyPageHost;
  linkifyPageHost = null;
  try {
    return renderMarkdown(text);
  } finally {
    linkifyPageHost = savedHost;
  }
}

/**
 * Single choke point for rendering untrusted Markdown into the DOM. The HTML
 * is allow-list sanitized by renderMarkdown(); this setter keeps every sink
 * going through that path instead of raw innerHTML assignments.
 */
export function setMarkdownHtml(element, source, { stored = false } = {}) {
  if (!element) return;
  element.innerHTML = stored
    ? renderStoredSummaryMarkdown(source)
    : renderMarkdown(source);
}
