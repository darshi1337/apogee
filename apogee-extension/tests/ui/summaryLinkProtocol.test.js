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
    /new URL\(url, window\.location\.href\)\.protocol/,
  );
  assert.match(
    summaryLinkHandler,
    /protocol !== "http:" && protocol !== "https:"/,
    "summary links must reject javascript:, data:, and other non-http(s) protocols",
  );
});
