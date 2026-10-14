import test from "node:test";
import assert from "node:assert";

import { readSource } from "../helpers/readSource.js";
import {
  createSummarizeProgressTracker,
  WORD_REPORT_EVERY,
} from "../../lib/summarize/progress.js";

// Shared narration for long map-reduce jobs (offscreen + service worker):
// stage labels, a sticky "Long page" prefix after truncation, and a
// word-count ticker. The sink differs per runtime, so it is injected.

test("word ticker fires every WORD_REPORT_EVERY tokens", () => {
  assert.strictEqual(WORD_REPORT_EVERY, 24);
  const lines = [];
  const tracker = createSummarizeProgressTracker((text) => lines.push(text));
  tracker.onProgress({ stage: "map", index: 0, total: 3 });
  for (let count = 1; count <= WORD_REPORT_EVERY; count++) {
    tracker.trackWord(count);
  }
  assert.deepStrictEqual(lines, [
    "Summarizing part 1 of 3...",
    "Summarizing part 1 of 3... (24 words)",
  ]);
});

test("ticker stays silent between cadence points", () => {
  const lines = [];
  const tracker = createSummarizeProgressTracker((text) => lines.push(text));
  tracker.trackWord(1);
  tracker.trackWord(23);
  tracker.trackWord(25);
  assert.deepStrictEqual(lines, []);
});

test("stage events map to status lines", () => {
  const lines = [];
  const tracker = createSummarizeProgressTracker((text) => lines.push(text));
  tracker.onProgress({ stage: "map", index: 1, total: 4 });
  tracker.onProgress({ stage: "reduce" });
  tracker.onProgress({ stage: "translate" });
  assert.deepStrictEqual(lines, [
    "Summarizing part 2 of 4...",
    "Merging summary...",
    "Translating...",
  ]);
});

test("truncation prefix sticks to later stages and the ticker", () => {
  const lines = [];
  const tracker = createSummarizeProgressTracker((text) => lines.push(text));
  tracker.onProgress({ stage: "truncated" });
  tracker.onProgress({ stage: "reduce" });
  tracker.trackWord(WORD_REPORT_EVERY);
  assert.deepStrictEqual(lines, [
    "Long page - summarizing the key parts.",
    "Long page - summarizing the key parts. Merging summary...",
    `Long page - summarizing the key parts. Merging summary... (${WORD_REPORT_EVERY} words)`,
  ]);
});

// Wiring guards: all three summarize runtimes must share this tracker
// instead of growing their own stage-mapping copies (same style as
// offscreenKeepAlive.test.js).
test("all summarize runtimes share the progress tracker", () => {
  for (const relPath of [
    "../../offscreen/offscreen.js",
    "../../background/service-worker.js",
  ]) {
    const code = readSource(relPath, import.meta.url);
    assert.ok(
      code.includes("createSummarizeProgressTracker"),
      `${relPath} uses the shared tracker`,
    );
  }
  const worker = readSource(
    "../../background/service-worker.js",
    import.meta.url,
  );
  assert.strictEqual(
    (worker.match(/onProgress: tracker\.onProgress/g) || []).length,
    2,
    "worker routes both local-HTTP and transformers progress through the tracker",
  );
  assert.ok(
    !worker.includes("longNote") && !worker.includes("stageLabel"),
    "worker keeps no local copy of the tracker state",
  );
  const offscreen = readSource("../../offscreen/offscreen.js", import.meta.url);
  assert.ok(
    offscreen.includes("onProgress: tracker.onProgress"),
    "offscreen routes transformers progress through the tracker",
  );
  assert.ok(
    !offscreen.includes("longNote") && !offscreen.includes("stageLabel"),
    "offscreen keeps no local copy of the tracker state",
  );
});

test("cleanup window is defined once and shared", () => {
  const worker = readSource("../../background/streams.js", import.meta.url);
  assert.ok(
    /import\s*\{[^}]*msToAlarmMinutes[^}]*STREAM_CLEANUP_MS[^}]*\}\s*from\s*"\.\.\/lib\/util\/streamExpiry\.js"/.test(
      worker,
    ) ||
      /import\s*\{[^}]*STREAM_CLEANUP_MS[^}]*msToAlarmMinutes[^}]*\}\s*from\s*"\.\.\/lib\/util\/streamExpiry\.js"/.test(
        worker,
      ),
    "worker derives its alarm window from the shared constant",
  );
  assert.ok(
    !worker.includes("STREAM_CLEANUP_MINUTES = 2"),
    "worker keeps no second copy of the 2-min window",
  );
});
