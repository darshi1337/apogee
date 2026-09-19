import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appCode = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

test("model download progress decorates the spinner verb instead of replacing it", () => {
  assert.ok(
    appCode.includes("mirrorModelProgressIntoLoading(p, message.modelId)"),
    "model-progress handler must mirror download progress into the loading indicator",
  );
  assert.ok(
    appCode.includes("`${verb} (${pct}%)`"),
    "mirror must keep the spinner verb and append the percent",
  );
  assert.ok(
    appCode.includes('querySelector(".apogee-loading")'),
    "mirror must only touch the loading state, never rendered summary text",
  );
});

test("summarize spinner verb is stored for progress decoration", () => {
  assert.ok(
    appCode.includes("function setSummarizeLoading()"),
    "summarize loading must go through a helper that remembers the verb",
  );
  assert.ok(
    !appCode.includes(
      "setLoadingIndicator(summaryText, randomSummarizeVerb())",
    ),
    "all summarize loading starts must use the verb-remembering helper",
  );
});

test("mirrored progress label resets with each stream", () => {
  const resets = appCode.match(/lastMirroredProgressLabel = null;/g) || [];
  assert.ok(
    resets.length >= 4,
    "summarize/ask show/hide must reset the mirrored label so reruns update",
  );
});
