import test from "node:test";
import assert from "node:assert";

import {
  escapeHtml,
  isSafeMarkdownHref,
  renderMarkdown,
  renderStoredSummaryMarkdown,
  sanitizeMarkdownHtml,
  setLinkifyOriginFromUrl,
  setLinkifyPageHostForTests,
} from "../../lib/util/markdown.js";

function resetLinkify() {
  setLinkifyPageHostForTests(null);
}

test("javascript: and data: URLs are never linkified (#187)", () => {
  resetLinkify();
  for (const src of [
    "[click](javascript:alert(1))",
    "[click](JaVaScRiPt:alert(1))",
    "[click](data:text/html,<script>alert(1)</script>)",
    "[click](vbscript:msgbox(1))",
    "[click](blob:https://example.com/uuid)",
  ]) {
    const html = renderMarkdown(src);
    assert.ok(!html.includes("<a"), `must not linkify: ${src}`);
    assert.ok(!html.includes("href="), `no href sink: ${src}`);
  }
});

test("raw HTML and unclosed tags are escaped, not sunk (#187)", () => {
  resetLinkify();
  const html = renderMarkdown(
    '<img src=x onerror=alert(1)>\n<script>alert(2)</script>\n<div onclick="evil()">hi',
  );
  assert.ok(!html.includes("<img"), "img tag must be escaped");
  assert.ok(!html.includes("<script"), "script tag must be escaped");
  assert.ok(!html.includes("<div"), "div tag must be escaped");
  assert.ok(
    html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "payload survives only as escaped text",
  );
  assert.ok(html.includes("&lt;img"), "escaped tag should render as text");
});

test("attribute breakout via quotes in link URLs is rejected (#187)", () => {
  resetLinkify();
  const html = renderMarkdown(
    '[x](https://www.youtube.com/"onmouseover="alert(1))',
  );
  assert.ok(!html.includes("<a"), "quoted href must not become a link");
  assert.ok(!html.includes('onmouseover="'), "breakout must not survive");
});

test("private-use placeholder marks in input cannot inject links (#187)", () => {
  resetLinkify();
  const html = renderMarkdown(
    "\uE0000\uE000\n[real](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
  );
  assert.ok(!html.includes("undefined"), "missing link index leaked undefined");
  assert.ok(html.includes("<a href="), "genuine link still renders");
});

test("linkify allow-list: same-origin and youtube/bilibili only (#187)", () => {
  resetLinkify();
  setLinkifyOriginFromUrl("https://example.com/article");
  assert.ok(
    renderMarkdown("[a](https://example.com/other)").includes("<a href="),
    "same-origin links render",
  );
  assert.ok(
    renderMarkdown("[a](https://evil.example.net/x)").includes("<a href=") ===
      false,
    "cross-origin links are stripped to label text",
  );
  resetLinkify();
  assert.ok(
    renderMarkdown("[a](https://www.youtube.com/watch?v=1)").includes(
      "<a href=",
    ),
    "youtube links always render",
  );
  assert.ok(
    renderMarkdown("[a](https://www.bilibili.com/video/BV1xx411c7mD)").includes(
      "<a href=",
    ),
    "bilibili links always render",
  );
});

test("stored summaries strip same-origin links (cached-summary path, #187)", () => {
  setLinkifyOriginFromUrl("https://example.com/article");
  const html = renderStoredSummaryMarkdown(
    "[a](https://example.com/other)\n[b](https://www.youtube.com/watch?v=1)",
  );
  resetLinkify();
  assert.ok(
    !html.includes('https://example.com/other">'),
    "stored same-origin link must be stripped",
  );
  assert.ok(
    html.includes("https://www.youtube.com/watch?v=1"),
    "stored youtube link still renders",
  );
});

test("sanitizer is fail-closed for tags and attributes (#187)", () => {
  assert.strictEqual(
    sanitizeMarkdownHtml("<script>alert(1)</script><p>hi</p>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;<p>hi</p>",
  );
  const jsLink = sanitizeMarkdownHtml('<a href="javascript:alert(1)">x</a>');
  assert.ok(!jsLink.includes("<a"), "javascript: href must be dropped");
  assert.ok(jsLink.includes("x"), "link text survives as text");
  const evilAttr = sanitizeMarkdownHtml(
    '<a href="https://www.youtube.com/watch?v=1" onclick="evil()" style="color:red">x</a>',
  );
  assert.ok(!evilAttr.includes("onclick"), "event handlers stripped");
  assert.ok(!evilAttr.includes("style"), "style stripped");
  assert.ok(
    evilAttr.includes('href="https://www.youtube.com/watch?v=1"'),
    "safe href kept",
  );
  assert.ok(
    sanitizeMarkdownHtml('<p class="x" id="y">hi</p>') === "<p>hi</p>",
    "non-anchor attributes stripped",
  );
});

test("legit formatting still renders (no over-sanitizing, #187)", () => {
  resetLinkify();
  const html = renderMarkdown(
    "# Title\n\n**bold** and *italic* and `code`\n\n- one\n- two\n\n1. first\n2. second",
  );
  for (const tag of ["<h1>", "<strong>", "<em>", "<code>", "<ul>", "<ol>"]) {
    assert.ok(html.includes(tag), `expected ${tag} in output`);
  }
  assert.strictEqual(escapeHtml("<&\"'>"), "&lt;&amp;&quot;&#39;&gt;");
});

test("isSafeMarkdownHref rejects encoded breakouts and non-http schemes (#187)", () => {
  assert.strictEqual(isSafeMarkdownHref("https://www.youtube.com/x"), true);
  assert.strictEqual(isSafeMarkdownHref("javascript:alert(1)"), false);
  assert.strictEqual(isSafeMarkdownHref("https://x/&quot;evil"), false);
  assert.strictEqual(isSafeMarkdownHref("https://x/a b"), false);
  assert.strictEqual(isSafeMarkdownHref("https://x/<script>"), false);
  assert.strictEqual(isSafeMarkdownHref("not a url"), false);
});
