import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { parseHTML } from "linkedom";

const appCode = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

test("model-progress listener queries the real loading class from setLoadingIndicator (#442)", () => {
  const loadingClassMatch = appCode.match(
    /function setLoadingIndicator\([^)]*\)\s*\{[\s\S]*?wrapper\.className\s*=\s*"([^"]+)";/,
  );
  assert.ok(
    loadingClassMatch,
    "setLoadingIndicator defines loading wrapper class",
  );
  const loadingClass = loadingClassMatch[1];

  const progressBlockMatch = appCode.match(
    /if\s*\(\s*message\.type\s*===\s*"model-progress"[\s\S]*?\n\s{2}\}/,
  );
  assert.ok(progressBlockMatch, "model-progress message block found");
  const progressBlock = progressBlockMatch[0];

  assert.ok(
    progressBlock.includes(`summaryText?.querySelector(".${loadingClass}")`),
    `model-progress listener must query summaryText with .${loadingClass}`,
  );
  assert.ok(
    progressBlock.includes(`answerBox?.querySelector(".${loadingClass}")`),
    `model-progress listener must query answerBox with .${loadingClass}`,
  );
  assert.ok(
    !appCode.includes(".loading-state"),
    "app.js must not reference stale .loading-state class",
  );
});

// Behavior simulation of the model-progress indicator update (not an import of app.js globals)
test("stage progress update behavior simulation: updates while loading, ignored after first output", () => {
  const { document } = parseHTML("<div></div>");
  const container = document.createElement("div");

  const setLoading = (el, text) => {
    el.innerHTML = `<span class="apogee-loading"><span class="apogee-loading-text">${text}</span></span>`;
  };
  const tryUpdateStage = (el, text) => {
    if (el.querySelector(".apogee-loading")) {
      setLoading(el, text);
      return true;
    }
    return false;
  };

  // 1. Initial loading state present: stage updates succeed
  setLoading(container, "Synthesizing...");
  assert.ok(container.querySelector(".apogee-loading"));
  assert.strictEqual(
    container.querySelector(".apogee-loading-text").textContent,
    "Synthesizing...",
  );

  const updated = tryUpdateStage(container, "Summarizing part 1 of 3...");
  assert.strictEqual(updated, true);
  assert.strictEqual(
    container.querySelector(".apogee-loading-text").textContent,
    "Summarizing part 1 of 3...",
  );

  // 2. First token arrives: loading state cleared and streamed text replaces it
  container.textContent = "Here is the streamed summary text.";
  assert.strictEqual(container.querySelector(".apogee-loading"), null);

  // 3. Late progress message arrives: ignored and does not overwrite output
  const lateUpdated = tryUpdateStage(container, "Merging summary...");
  assert.strictEqual(lateUpdated, false);
  assert.strictEqual(
    container.textContent,
    "Here is the streamed summary text.",
  );
});
