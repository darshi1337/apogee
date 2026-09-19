import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appCode = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

test("model download progress mirrors into the summarizing loading state", () => {
  assert.ok(
    appCode.includes("mirrorModelProgressIntoLoading(p)"),
    "model-progress handler must mirror progress into the loading indicator",
  );
  assert.ok(
    appCode.includes('querySelector(".apogee-loading")'),
    "mirror must only touch the loading state, never rendered summary text",
  );
});

test("mirrored progress label resets with each stream", () => {
  const resets = appCode.match(/lastMirroredProgressLabel = null;/g) || [];
  assert.ok(
    resets.length >= 4,
    "summarize/ask show/hide must reset the mirrored label so reruns update",
  );
});
