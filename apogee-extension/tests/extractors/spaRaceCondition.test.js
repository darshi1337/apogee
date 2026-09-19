import test from "node:test";
import assert from "node:assert";
import { loadExtractors } from "./helpers/extractorHarness.js";

test("extractGmail handles unmounted/detached message elements gracefully", () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>Inbox</title></head>
      <body>
        <h1 class="hP">Important Conversation</h1>
        <div class="adn">
          <span class="gD" email="alice@example.com">Alice</span>
          <span class="g3" title="Aug 26, 2026">Aug 26</span>
          <div class="a3s">First message body</div>
        </div>
        <div class="adn">
          <span class="gD" email="bob@example.com">Bob</span>
          <span class="g3" title="Aug 26, 2026">Aug 26</span>
          <div class="a3s">Second message body</div>
        </div>
      </body>
    </html>
  `;

  const context = loadExtractors({
    files: ["extractors/thread.js", "extractors/gmail.js"],
    url: "https://mail.google.com/mail/u/0/#inbox/FMfcgx",
    html,
  });

  const messageEls = context.document.querySelectorAll("div.a3s");
  // Simulate SPA element detachment on the second message element
  Object.defineProperty(messageEls[1], "isConnected", {
    value: false,
    configurable: true,
  });

  const res = context.extractGmail();
  assert.ok(res);
  assert.strictEqual(res.type, "gmail");
  assert.strictEqual(res.title, "Important Conversation");
  assert.match(res.content, /First message body/);
  assert.doesNotMatch(res.content, /Second message body/);
});

test("extractDiscourse handles unmounted post elements gracefully", () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>Discourse Topic</title></head>
      <body>
        <div id="topic-title"><h1><a class="fancy-title">SPA Discussion</a></h1></div>
        <div class="post-stream">
          <div class="topic-post" id="post_1">
            <span class="username">alice</span>
            <div class="cooked">Original post content</div>
          </div>
          <div class="topic-post" id="post_2">
            <span class="username">bob</span>
            <div class="cooked">Reply post content</div>
          </div>
        </div>
      </body>
    </html>
  `;

  const context = loadExtractors({
    files: ["extractors/thread.js", "extractors/discourse.js"],
    url: "https://discourse.example.com/t/spa-discussion/123",
    html,
  });

  const posts = context.document.querySelectorAll(".topic-post");
  // Simulate SPA element detachment on the second post
  Object.defineProperty(posts[1], "isConnected", {
    value: false,
    configurable: true,
  });

  const res = context.extractDiscourse();
  assert.ok(res);
  assert.strictEqual(res.type, "discourse");
  assert.match(res.title, /SPA Discussion/);
  assert.match(res.content, /Original post content/);
  assert.doesNotMatch(res.content, /Reply post content/);
});
