import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/github.js"];

function stubFetch(textPayload, { ok = true } = {}) {
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push({ url, options });
    return {
      ok,
      text: async () => textPayload,
    };
  };
  return { fetchStub, calls };
}

function load(url, html, fetchStub) {
  return loadExtractors({
    files: FILES,
    url,
    html,
    fetch: fetchStub,
  });
}

test("extractGitHub extracts repository landing page with README and topics", async () => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>owner/repo: A project summary</title>
        <meta property="og:description" content="An awesome open source project." />
      </head>
      <body>
        <a class="topic-tag" href="/topics/javascript">javascript</a>
        <a class="topic-tag" href="/topics/testing">testing</a>
        <div id="readme">
          <article class="markdown-body">
            <h1>Project Title</h1>
            <p>This is the README text for the repository.</p>
          </article>
        </div>
      </body>
    </html>
  `;

  const { extractGitHub } = load("https://github.com/owner/repo", html);
  const result = await extractGitHub();

  assert.strictEqual(result.type, "github");
  assert.strictEqual(result.title, "owner/repo");
  assert.strictEqual(result.url, "https://github.com/owner/repo");
  assert.match(result.content, /^GitHub repository: owner\/repo/);
  assert.match(result.content, /Description: An awesome open source project\./);
  assert.match(result.content, /Topics: javascript, testing/);
  assert.match(
    result.content,
    /README:\nProject Title\nThis is the README text for the repository\./,
  );
});

test("extractGitHub extracts issue title, state, description, and comments", async () => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Bug in parser · Issue #42 · owner/repo</title>
      </head>
      <body>
        <h1 class="js-issue-title">Bug in parser</h1>
        <span class="State">Open</span>
        <div class="timeline-comment">
          <a class="author">alice</a>
          <div class="comment-body">Parser fails on empty strings.</div>
        </div>
        <div class="timeline-comment">
          <a class="author">bob</a>
          <div class="comment-body">I can reproduce this behavior.</div>
        </div>
      </body>
    </html>
  `;

  const { extractGitHub } = load(
    "https://github.com/owner/repo/issues/42",
    html,
  );
  const result = await extractGitHub();

  assert.strictEqual(result.type, "github");
  assert.strictEqual(result.title, "Bug in parser");
  assert.strictEqual(result.url, "https://github.com/owner/repo/issues/42");
  assert.match(result.content, /^GitHub issue in owner\/repo \(#42\)/);
  assert.match(result.content, /Title: Bug in parser/);
  assert.match(result.content, /State: Open/);
  assert.match(
    result.content,
    /Description \(by alice\):\nParser fails on empty strings\./,
  );
  assert.match(
    result.content,
    /Comments:\n- bob: I can reproduce this behavior\./,
  );
});

test("extractGitHub extracts pull request metadata with DOM-only diff and no network fetch", async () => {
  const { fetchStub, calls } = stubFetch("unused");
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Add new feature · Pull Request #101 · owner/repo</title>
      </head>
      <body>
        <span data-testid="issue-title">Add new feature</span>
        <span data-testid="header-state">Merged</span>
        <div class="timeline-comment">
          <a class="author">carol</a>
          <div class="comment-body">This pull request adds feature X.</div>
        </div>
        <div class="diff-table">
          <table>
            <tr>
              <td class="blob-code blob-code-deletion">
                <span class="blob-code-inner" data-code-marker="-">const oldVal = 1;</span>
              </td>
            </tr>
            <tr>
              <td class="blob-code blob-code-addition">
                <span class="blob-code-inner">const newVal = 2;</span>
              </td>
            </tr>
          </table>
        </div>
      </body>
    </html>
  `;

  const { extractGitHub } = load(
    "https://github.com/owner/repo/pull/101",
    html,
    fetchStub,
  );
  const result = await extractGitHub();

  assert.strictEqual(result.type, "github");
  assert.strictEqual(result.title, "Add new feature");
  assert.strictEqual(result.url, "https://github.com/owner/repo/pull/101");
  assert.match(result.content, /^GitHub pull request in owner\/repo \(#101\)/);
  assert.match(result.content, /Title: Add new feature/);
  assert.match(result.content, /State: Merged/);
  assert.match(
    result.content,
    /Description \(by carol\):\nThis pull request adds feature X\./,
  );
  assert.match(
    result.content,
    /Code changes \(unified diff\):\n- const oldVal = 1;\n\+ const newVal = 2;/,
  );

  assert.strictEqual(
    calls.length,
    0,
    "PR extraction must not make any network request",
  );
});

test("extractGitHub reports diff unavailable when no diff DOM is rendered", async () => {
  const { fetchStub, calls } = stubFetch("unused", { ok: false });
  const html = `
    <!doctype html>
    <html>
      <body>
        <h1 class="js-issue-title">Fix typo</h1>
        <div class="timeline-comment">
          <a class="author">dave</a>
          <div class="comment-body">Fixed typo in doc.</div>
        </div>
      </body>
    </html>
  `;

  const { extractGitHub } = load(
    "https://github.com/owner/repo/pull/202",
    html,
    fetchStub,
  );
  const result = await extractGitHub();

  assert.strictEqual(result.type, "github");
  assert.match(result.content, /\(Diff unavailable\.\)/);
  assert.strictEqual(
    calls.length,
    0,
    "PR extraction must not make any network request",
  );
});

test("extractGitHub returns null for unhandled pages or landing page without README", async () => {
  const htmlNoReadme = `
    <!doctype html>
    <html>
      <head><title>owner/repo</title></head>
      <body><div>No readme here</div></body>
    </html>
  `;

  const { extractGitHub: landingNoReadme } = load(
    "https://github.com/owner/repo",
    htmlNoReadme,
  );
  assert.strictEqual(await landingNoReadme(), null);

  const { extractGitHub: subPage } = load(
    "https://github.com/owner/repo/tree/main",
    htmlNoReadme,
  );
  assert.strictEqual(await subPage(), null);

  const { extractGitHub: profilePage } = load(
    "https://github.com/owner",
    htmlNoReadme,
  );
  assert.strictEqual(await profilePage(), null);
});

test("github extractor source performs no network fetch (#180)", () => {
  const source = readFileSync(
    new URL("../../content/extractors/github.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/\bfetch\s*\(/.test(source),
    "github.js must not call fetch(); PR diffs are scraped from the page DOM",
  );
  assert.ok(
    !source.includes("api.github.com"),
    "github.js must not reference the undisclosed api.github.com egress",
  );
});
