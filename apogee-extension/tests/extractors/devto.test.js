import test from "node:test";
import assert from "node:assert/strict";
import { loadExtractors } from "./helpers/extractorHarness.js";

const FILES = ["extractors/thread.js", "extractors/devto.js"];
const URL = "https://dev.to/alice/why-i-still-write-vanilla-css-1a2b";

test("Dev.to extractor: parses article title, author, date, tags, body, and threaded comments", () => {
  const { extractDevto } = loadExtractors({
    files: FILES,
    url: URL,
    fixture: "devto-article.html",
  });

  const result = extractDevto();

  assert.equal(result.type, "devto");
  assert.equal(result.title, "Why I still write vanilla CSS");
  assert.equal(result.url, URL);

  assert.match(result.content, /Title: Why I still write vanilla CSS/);
  assert.match(result.content, /Author: Alice/);
  assert.match(result.content, /2024-08-18/);
  assert.match(result.content, /Tags: css, webdev/);
  assert.match(result.content, /Every few months a new CSS framework lands/);

  assert.match(
    result.content,
    /\[1\] (<replies: 1> )?Bob: Custom properties really did change the game/,
  );
  assert.match(
    result.content,
    /\[1\.1\] Carol: Agreed, and container queries removed/,
  );
  assert.match(result.content, /\[2\] Dave: Counterpoint: on a large team/);
});

test("Dev.to extractor: returns null for home, tag, and profile pages", () => {
  const html = `<!doctype html>
<html>
  <head><title>DEV Community</title></head>
  <body><main><h1>DEV Community</h1></main></body>
</html>`;

  for (const url of [
    "https://dev.to/",
    "https://dev.to/t/css",
    "https://dev.to/alice",
    "https://dev.to/search?q=css",
  ]) {
    const { extractDevto } = loadExtractors({ files: FILES, url, html });
    assert.equal(extractDevto(), null, `${url} should return null`);
  }
});

test("Dev.to extractor: returns null off dev.to", () => {
  const { extractDevto } = loadExtractors({
    files: FILES,
    url: "https://example.com/alice/why-i-still-write-vanilla-css-1a2b",
    fixture: "devto-article.html",
  });

  assert.equal(extractDevto(), null);
});
