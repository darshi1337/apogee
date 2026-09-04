import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

test("popup onMessage listeners validate the sender (#207)", async () => {
  const appCode = fs.readFileSync(
    new URL("../../ui/app.js", import.meta.url),
    "utf-8",
  );

  const listeners =
    appCode.match(
      /chrome\.runtime\.onMessage\.addListener\(\(message, sender\) => \{/g,
    ) || [];
  assert.ok(
    listeners.length >= 2,
    "expected at least two sender-aware popup listeners",
  );

  const guards =
    appCode.match(
      /if \(sender\?\.id && sender\.id !== chrome\.runtime\.id\) return;/g,
    ) || [];
  assert.ok(
    guards.length >= listeners.length,
    "every popup onMessage listener must reject foreign senders",
  );
});
