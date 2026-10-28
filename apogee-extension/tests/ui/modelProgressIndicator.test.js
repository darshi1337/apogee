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
    progressBlock.includes('const isDownload = p.kind === "download"'),
    "model-progress listener must separate download progress",
  );
  assert.ok(
    progressBlock.includes("if (isDownload)"),
    "download progress must update the top card only",
  );
  assert.ok(
    progressBlock.includes("else if (p.text)"),
    "stage progress must update the loading text only",
  );
  assert.ok(
    !appCode.includes(".loading-state"),
    "app.js must not reference stale .loading-state class",
  );
});

// Behavior simulation of the model-progress indicator update (not an import of app.js globals)
test("download progress stays on top; stage progress updates while loading, ignored after first output", () => {
  const { document } = parseHTML("<div></div>");
  const container = document.createElement("div");
  let topText = "";

  const setLoading = (el, text) => {
    el.innerHTML = `<span class="apogee-loading"><span class="apogee-loading-text">${text}</span></span>`;
  };
  const routeProgress = (progress) => {
    if (progress.kind === "download") {
      topText = progress.text;
      return "top";
    }
    if (progress.text && container.querySelector(".apogee-loading")) {
      setLoading(container, progress.text);
      return "bottom";
    }
    return "none";
  };

  // 1. Initial loading state present: download progress stays on the top card
  setLoading(container, "Synthesizing...");
  assert.ok(container.querySelector(".apogee-loading"));
  assert.strictEqual(
    container.querySelector(".apogee-loading-text").textContent,
    "Synthesizing...",
  );

  const downloadTarget = routeProgress({
    text: "Fetching param cache[6/30]: 151MB fetched. 18% complete.",
    kind: "download",
  });
  assert.strictEqual(downloadTarget, "top");
  assert.strictEqual(
    topText,
    "Fetching param cache[6/30]: 151MB fetched. 18% complete.",
  );
  assert.strictEqual(
    container.querySelector(".apogee-loading-text").textContent,
    "Synthesizing...",
  );

  // 2. Stage progress still updates the loading text
  const stageTarget = routeProgress({
    text: "Summarizing part 1 of 3...",
  });
  assert.strictEqual(stageTarget, "bottom");
  assert.strictEqual(
    container.querySelector(".apogee-loading-text").textContent,
    "Summarizing part 1 of 3...",
  );

  // 3. First token arrives: loading state cleared and streamed text replaces it
  container.textContent = "Here is the streamed summary text.";
  assert.strictEqual(container.querySelector(".apogee-loading"), null);

  // 4. Late progress message arrives: ignored and does not overwrite output
  const lateTarget = routeProgress({ text: "Merging summary..." });
  assert.strictEqual(lateTarget, "none");
  assert.strictEqual(
    container.textContent,
    "Here is the streamed summary text.",
  );
});
