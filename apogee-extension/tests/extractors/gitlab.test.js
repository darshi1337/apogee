import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/gitlab.js"];

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

test("extractGitLab extracts merge request metadata with DOM-only diff", async () => {
  const { fetchStub, calls } = stubFetch("unused");
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Add retry logic (!7) · group / subgroup / project · GitLab</title>
      </head>
      <body>
        <h1 data-testid="issuable-title">Add retry logic</h1>
        <span data-testid="issuable-state">Merged</span>
        <div class="note" data-testid="note">
          <div class="note-header"><a data-testid="author-link">alice</a></div>
          <div data-testid="note-body">This MR adds retries around the fetch call.</div>
        </div>
        <div class="note" data-testid="note">
          <div class="note-header"><a data-testid="author-link">bob</a></div>
          <div data-testid="note-body">Looks good, one nit below.</div>
        </div>
        <div class="diff-table">
          <div class="line_holder old">
            <span class="diff-line-num">41</span>
            <span class="line_content">-const timeout = 1000;</span>
          </div>
          <div class="line_holder new">
            <span class="diff-line-num">41</span>
            <span class="line_content">+const timeout = 5000;</span>
          </div>
        </div>
      </body>
    </html>
  `;

  const { extractGitLab } = load(
    "https://gitlab.com/group/subgroup/project/-/merge_requests/7",
    html,
    fetchStub,
  );
  const result = await extractGitLab();

  assert.strictEqual(result.type, "gitlab");
  assert.strictEqual(result.title, "Add retry logic");
  assert.strictEqual(
    result.url,
    "https://gitlab.com/group/subgroup/project/-/merge_requests/7",
  );
  assert.match(
    result.content,
    /^GitLab merge request in group\/subgroup\/project \(!7\)/,
  );
  assert.match(result.content, /Title: Add retry logic/);
  assert.match(result.content, /State: Merged/);
  assert.match(
    result.content,
    /Description \(by alice\):\nThis MR adds retries around the fetch call\./,
  );
  assert.match(
    result.content,
    /Discussion:\n- bob: Looks good, one nit below\./,
  );
  assert.match(
    result.content,
    /Code changes \(unified diff\):\n- const timeout = 1000;\n\+ const timeout = 5000;/,
  );
  // Line-number cells must not leak into the diff body.
  assert.doesNotMatch(result.content, /\n-? ?41\n/);

  assert.strictEqual(
    calls.length,
    0,
    "MR extraction must not make any network request",
  );
});

test("extractGitLab extracts issues with a # sigil and no diff section", async () => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Flaky test on main (#3) · group / project · GitLab</title>
      </head>
      <body>
        <h1 data-testid="issuable-title">Flaky test on main</h1>
        <span data-testid="issuable-state">Opened</span>
        <div class="note-body">The nightly run fails intermittently.</div>
      </body>
    </html>
  `;

  const { extractGitLab } = load(
    "https://gitlab.com/group/project/-/issues/3",
    html,
  );
  const result = await extractGitLab();

  assert.strictEqual(result.type, "gitlab");
  assert.strictEqual(result.title, "Flaky test on main");
  assert.match(result.content, /^GitLab issue in group\/project \(#3\)/);
  assert.match(result.content, /State: Opened/);
  assert.match(
    result.content,
    /Description:\nThe nightly run fails intermittently\./,
  );
  assert.ok(!result.content.includes("Code changes"));
  assert.ok(!result.content.includes("Diff unavailable"));
});

test("extractGitLab reports diff unavailable when no diff DOM is rendered", async () => {
  const { fetchStub, calls } = stubFetch("unused", { ok: false });
  const html = `
    <!doctype html>
    <html>
      <body>
        <h1 data-testid="issuable-title">Update docs</h1>
        <div class="note-body">Docs only change.</div>
      </body>
    </html>
  `;

  const { extractGitLab } = load(
    "https://gitlab.com/group/project/-/merge_requests/9",
    html,
    fetchStub,
  );
  const result = await extractGitLab();

  assert.strictEqual(result.type, "gitlab");
  assert.match(result.content, /\(Diff unavailable\.\)/);
  assert.strictEqual(
    calls.length,
    0,
    "MR extraction must not make any network request",
  );
});

test("extractGitLab returns null for unhandled pages", async () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>group / project · GitLab</title></head>
      <body><div>Project overview</div></body>
    </html>
  `;

  const { extractGitLab: treePage } = load(
    "https://gitlab.com/group/project/-/tree/main",
    html,
  );
  assert.strictEqual(await treePage(), null);

  const { extractGitLab: groupPage } = load(
    "https://gitlab.com/group/project",
    html,
  );
  assert.strictEqual(await groupPage(), null);

  const { extractGitLab: otherHost } = load(
    "https://example.com/group/project/-/issues/3",
    html,
  );
  assert.strictEqual(await otherHost(), null);
});

test("gitlab extractor source performs no network fetch", () => {
  const source = readFileSync(
    new URL("../../content/extractors/gitlab.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/\bfetch\s*\(/.test(source),
    "gitlab.js must not call fetch(); MR diffs are scraped from the page DOM",
  );
  const urls = source.match(/https:\/\/[^\s"'`]+/g) || [];
  for (const raw of urls) {
    const host = new URL(raw.replace(/[.,;)\]]+$/, "")).hostname.toLowerCase();
    assert.strictEqual(
      host,
      "gitlab.com",
      `gitlab.js must not reference off-page host ${host}`,
    );
  }
});
