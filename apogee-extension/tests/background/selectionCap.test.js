import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { MAX_PASTED_CHARS } from "../../lib/extract/fileLimits.js";
import { loadViewState } from "../../lib/storage/viewState.js";

// --- #471: an oversized selection must be capped before it fans out ---
//
// Pasted text and files are bounded, but a selection reached
// runBackgroundSummarize with no ceiling and was copied whole into the
// saved view state, the finalize payload, and the model prompt.

// The Local provider gets the run past the offscreen-only WebLLM path to the
// view-state write. fetch records every request body and answers with a
// minimal NDJSON chat stream, so the map/reduce pipeline reaches the chunks
// that carry the truncation note. `node --test` runs each file in its own
// process, so neither stub leaks into other files.
const { chrome } = createExtensionApiMock({ settings: { provider: "local" } });
chrome.alarms = {
  create: () => {},
  clear: async () => {},
  onAlarm: { addListener: () => {} },
};
globalThis.chrome = chrome;

const requestBodies = [];
globalThis.fetch = async (_url, init) => {
  requestBodies.push(String(init?.body ?? ""));
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('{"message":{"content":"ok"},"done":false}\n'),
      );
      controller.enqueue(encoder.encode('{"done":true}\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
};

const { runBackgroundSummarize } =
  await import("../../background/service-worker.js");

const TAB = {
  id: 101,
  url: "https://example.com/article",
  title: "Example Article",
  windowId: 1,
};

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

test("runBackgroundSummarize caps an oversized selection with a note (#471)", async () => {
  requestBodies.length = 0;

  await runBackgroundSummarize(TAB, {
    notifyOnFinish: false,
    selectionText: "word ".repeat(MAX_PASTED_CHARS),
  });

  const state = await loadViewState(TAB.id);
  assert.equal(state.isSelection, true);
  assert.ok(
    state.selectionText.length <= MAX_PASTED_CHARS,
    `selection kept ${state.selectionText.length} characters`,
  );
  assert.ok(state.selectionText.startsWith("word word word"));
  assert.match(
    state.selectionText,
    new RegExp(
      `\\[\\.\\.\\.selected content truncated to the first ${MAX_PASTED_CHARS} characters\\.\\.\\.\\]$`,
    ),
  );

  // The capped text is what reaches the model: the truncation note rides in
  // one of the chunked chat request bodies.
  assert.ok(
    await waitFor(() =>
      requestBodies.some((body) => body.includes("selected content truncated")),
    ),
    "no model request carried the selected-text truncation note",
  );
});
