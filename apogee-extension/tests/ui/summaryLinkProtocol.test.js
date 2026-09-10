import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appCode = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

const summaryLinkHandler = appCode.match(
  /summaryText\?\.addEventListener\("click", \(event\) => \{[\s\S]*?\n\}\);/,
)?.[0];

test("summary links allow only http(s) protocols (#266)", () => {
  assert.ok(summaryLinkHandler, "summary link click handler must exist");
  assert.match(
    summaryLinkHandler,
    /resolveNavigableHttpUrl\(\s*link\.getAttribute\("href"\),\s*window\.location\.href,?\s*\)/,
    "handler must resolve the href through the http(s) allowlist",
  );
  assert.match(
    summaryLinkHandler,
    /if\s*\(\s*!url\s*\)\s*return;/,
    "summary links must bail on javascript:, data:, and other non-http(s) hrefs",
  );
});
