// Minimal Markdown-to-HTML renderer for untrusted model and cache output.
// Everything is escaped first; only a small tag allow-list returns, with a
// fail-closed sanitizer so a regex misfire still escapes instead of sinking.
import { tryParseUrl } from "./url.js";

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LINK_TOKEN_PREFIX = "@@APOGEE-LINK-";
const LINK_TOKEN_SUFFIX = "@@";
const LINK_TOKEN_RE = /@@APOGEE-LINK-(\d+)@@/g;
const LINK_TOKEN_STRIP_RE = /@@APOGEE-LINK-\d+@@/g;

const ALWAYS_LINKIFY_HOSTS = new Set(["youtube.com", "bilibili.com"]);

let linkifyPageHost = null;

export function setLinkifyPageHostForTests(host) {
  linkifyPageHost = host;
}

function normalizeLinkHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^(www\.|m\.)/, "");
  return h === "youtu.be" ? "youtube.com" : h;
}

export function setLinkifyOriginFromUrl(url) {
  const parsed = tryParseUrl(url);
  linkifyPageHost = parsed ? normalizeLinkHost(parsed.hostname) : null;
}

function isLinkifiableHref(href, { allowAlwaysHosts = true } = {}) {
  const parsed = tryParseUrl(href);
  if (!parsed) return false;
  const host = normalizeLinkHost(parsed.hostname);
  // Stored summaries render with no page host and no always-linkify hosts,
  // so planted links stay plain text (#212).
  if (ALWAYS_LINKIFY_HOSTS.has(host)) return allowAlwaysHosts;
  return host === linkifyPageHost;
}

// Resolve a clicked href to an absolute http(s) URL, or null when unsafe.
// Obfuscated schemes and non-http bases are rejected, so navigation never
// outruns the sanitizer (#266).
export function resolveNavigableHttpUrl(href, base) {
  if (typeof href !== "string" || href === "") return null;
  const resolved = tryParseUrl(href, base);
  if (!resolved) return null;
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }
  return resolved.href;
}

// Reject hrefs that could break out of the attribute or use a dangerous
// scheme. Only plain http(s) urls without whitespace survive.
export function isSafeMarkdownHref(href) {
  if (!href || typeof href !== "string") return false;
  if (/[\s<>"']/.test(href)) return false;
  if (/&(lt|gt|quot);|&#39;|&#x27;/i.test(href)) return false;
  let decoded = href.replace(/&amp;/g, "&");
  if (/[\s<>"']/.test(decoded)) return false;
  const parsed = tryParseUrl(decoded);
  if (!parsed) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return true;
}

function extractMarkdownLinks(escapedText, { allowAlwaysHosts = true } = {}) {
  const links = [];
  const cleanText = String(escapedText).replace(LINK_TOKEN_STRIP_RE, "");
  const text = cleanText.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (match, label, href) => {
      if (
        !isSafeMarkdownHref(href) ||
        !isLinkifiableHref(href, { allowAlwaysHosts })
      )
        return label;
      links.push(
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`,
      );
      return `${LINK_TOKEN_PREFIX}${links.length - 1}${LINK_TOKEN_SUFFIX}`;
    },
  );
  return { text, links };
}

function renderInline(escapedText, { allowAlwaysHosts = true } = {}) {
  const { text, links } = extractMarkdownLinks(escapedText, {
    allowAlwaysHosts,
  });
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>")
    .replace(LINK_TOKEN_RE, (match, i) => links[Number(i)] ?? match);
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
  // Escaped hrefs encode quotes; a raw quote means the tag did not come
  // from the renderer, so drop the link.
  if (!isSafeMarkdownHref(href)) return null;
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
}

// Fail-closed sanitizer for renderer output. Only emitted formatting tags
// survive; the rest escapes to text. Pure string processing for pages and
// node tests.
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

export function renderMarkdown(source, { stored = false } = {}) {
  // Strip legacy marks so cached text cannot inject link placeholders.
  const allowAlwaysHosts = !stored;
  const inline = (escapedText) =>
    renderInline(escapedText, { allowAlwaysHosts });
  const lines = escapeHtml(stripEchoedFences(source ?? ""))
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
      html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${inline(ordered[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return sanitizeMarkdownHtml(html);
}

// Small models often open with a redundant "Summary" heading. The card
// already carries that title, so drop one leading heading line only.
export function stripLeadingSummaryHeading(text) {
  return String(text ?? "").replace(
    /^\s*(?:#{1,6}\s*|\*\*)?summary(?::|\*\*)?[ \t]*(?:\n|$)/i,
    "",
  );
}

// Small models sometimes echo the input fences into their answer. Those
// markers must never display, so strip every occurrence.
function stripEchoedFences(text) {
  return String(text ?? "")
    .replaceAll("<<<APOGEE_CONTENT", "")
    .replaceAll("APOGEE_CONTENT>>>", "");
}

// Combined cleanup: fences first since they may precede the heading.
export function cleanModelOutput(text) {
  const noFence = stripEchoedFences(String(text ?? "").trimStart()).trimStart();
  return stripLeadingSummaryHeading(noFence);
}

export function renderStoredSummaryMarkdown(text) {
  // Stored summaries have no page context, so every link stays plain
  // label text instead of clickable (#212).
  const savedHost = linkifyPageHost;
  linkifyPageHost = null;
  try {
    return renderMarkdown(text, { stored: true });
  } finally {
    linkifyPageHost = savedHost;
  }
}

// Single choke point for untrusted Markdown into the DOM. All sinks go
// through the sanitized renderer instead of raw innerHTML.
export function setMarkdownHtml(element, source, { stored = false } = {}) {
  if (!element) return;
  element.innerHTML = stored
    ? renderStoredSummaryMarkdown(source)
    : renderMarkdown(source);
}
