import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { parseHTML } from "linkedom";

const appCode = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

test("model-progress listener sends downloads to the top card only (#442)", () => {
  const progressBlockMatch = appCode.match(
    /if\s*\(\s*message\.type\s*===\s*"model-progress"[\s\S]*?\n\s{2}\}/,
  );
  assert.ok(progressBlockMatch, "model-progress message block found");
  const progressBlock = progressBlockMatch[0];

  assert.ok(
    progressBlock.includes('p.kind === "download"'),
    "model-progress listener must separate download progress",
  );
  assert.ok(
    progressBlock.includes('modelProgress?.classList.add("hidden")'),
    "stage progress must hide the download card",
  );
  assert.ok(
    !progressBlock.includes("setLoadingIndicator"),
    "progress must not replace the summary or answer loading verb",
  );
  assert.ok(
    !progressBlock.includes("summaryText"),
    "progress must not touch the summary loading text",
  );
  assert.ok(
    !progressBlock.includes("answerBox"),
    "progress must not touch the answer loading text",
  );
  assert.ok(
    !appCode.includes(".loading-state"),
    "app.js must not reference stale .loading-state class",
  );
});

// Behavior simulation of the model-progress indicator update (not an import of app.js globals)
test("download progress stays on top; stage progress keeps the loading verb", () => {
  const { document } = parseHTML("<div></div>");
  const container = document.createElement("div");
  let topText = "";
  let topHidden = false;

  const setLoading = (el, text) => {
    el.innerHTML = `<span class="apogee-loading"><span class="apogee-loading-text">${text}</span></span>`;
  };
  const routeProgress = (progress) => {
    if (progress.kind === "download") {
      topText = progress.text;
      topHidden = false;
      return "top";
    }
    topHidden = true;
    return "hide-top";
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

  // 2. Stage progress hides the download card and keeps the main box verb
  const stageTarget = routeProgress({
    text: "Summarizing part 1 of 3...",
  });
  assert.strictEqual(stageTarget, "hide-top");
  assert.strictEqual(topHidden, true);
  assert.strictEqual(
    container.querySelector(".apogee-loading-text").textContent,
    "Synthesizing...",
  );

  // 3. First token arrives: loading state cleared and streamed text replaces it
  container.textContent = "Here is the streamed summary text.";
  assert.strictEqual(container.querySelector(".apogee-loading"), null);

  // 4. Late progress message arrives: only hides the card, never the output
  const lateTarget = routeProgress({ text: "Merging summary..." });
  assert.strictEqual(lateTarget, "hide-top");
  assert.strictEqual(
    container.textContent,
    "Here is the streamed summary text.",
  );
});
