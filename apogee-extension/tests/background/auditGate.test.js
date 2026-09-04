import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

test("service worker only audits pages that are allowed to persist (#181)", async () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );

  assert.ok(
    /if \(persist\) \{\s*recordPageAccessEvent\(/.test(swCode),
    "recordPageAccessEvent must be gated on persist so sensitive pages and " +
      '"Don\'t save" sessions leave no title+URL trace in the audit log',
  );
});
