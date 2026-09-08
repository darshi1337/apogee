import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { UserFacingError } from "../../lib/util/userError.js";
import {
  COULD_NOT_READ_THIS_PAGE_ERROR_MSG,
  NOTHING_TO_SUMMARIZE_ERROR_MSG,
  COULD_NOT_EXTRACT_TEXT_FROM_PDF_ERROR_MSG,
} from "../../lib/util/messages.js";
import { MIN_SELECTION_LENGTH } from "../../lib/extract/selection.js";

test("runBackgroundSummarize only calls startLocalHttpStream once for Local Ollama (#151)", async () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );

  // Extract runBackgroundSummarize function body
  const fnMatch = swCode.match(
    /async function runBackgroundSummarize[\s\S]*?\n\}/,
  );
  assert.ok(fnMatch, "runBackgroundSummarize function found");
  const fnBody = fnMatch[0];

  // Count occurrences of startLocalHttpStream calls inside runBackgroundSummarize
  const callMatches = fnBody.match(/startLocalHttpStream\(/g) || [];
  // There should be exactly 2 startLocalHttpStream calls: one for PROVIDERS.LOCAL and one for PROVIDERS.LLAMACPP
  assert.strictEqual(
    callMatches.length,
    2,
    "runBackgroundSummarize should have exactly 2 startLocalHttpStream calls (one for LOCAL, one for LLAMACPP)",
  );

  // In the streamId initialization block, there should be NO startLocalHttpStream call
  const initBlockMatch = fnBody.match(
    /let streamId;[\s\S]*?registerStreamJob\(streamId/,
  );
  assert.ok(initBlockMatch, "streamId initialization block found");
  assert.ok(
    !initBlockMatch[0].includes("startLocalHttpStream("),
    "streamId init block should not call startLocalHttpStream before registerStreamJob",
  );
});

// --- #253: the empty-content branches must throw, not silently return ---
//
// runBackgroundSummarize used to guard its "nothing to summarize" notifications
// behind `if (notifyOnFinish)` and then `return` with no value. If a caller ever
// passed `notifyOnFinish: false`, the job would resolve to `undefined` and
// whatever awaited it would hang forever with no error and no notification.
// Each branch now throws a UserFacingError so the call site's
// `.catch(notifyJobFailed)` presents it.

const { chrome } = createExtensionApiMock({ settings: {} });
chrome.scripting = {
  // Version check short-circuits (matches getManifest().version) so no content
  // scripts are injected; for the PDF path this same stub returns a truthy
  // "base64" blob so extractPdfContent proceeds to the extract-pdf message.
  executeScript: async () => [{ result: "0.2.1" }],
};
globalThis.chrome = chrome;

const { runBackgroundSummarize } =
  await import("../../background/service-worker.js");

const TAB = {
  id: 101,
  url: "https://example.com/article",
  title: "Example Article",
  windowId: 1,
};

async function rejectsUserFacing(fn, expectedMessage, label) {
  let thrown;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }
  assert.ok(
    thrown !== undefined,
    `${label}: expected a throw, but the call resolved (the silent-return hazard)`,
  );
  assert.ok(
    thrown instanceof UserFacingError,
    `${label}: expected a UserFacingError, got ${thrown && thrown.constructor.name}`,
  );
  if (expectedMessage) {
    assert.strictEqual(thrown.message, expectedMessage, `${label}: message`);
  }
}

test("runBackgroundSummarize throws on a too-short selection instead of returning undefined (#253)", async () => {
  await rejectsUserFacing(
    () =>
      runBackgroundSummarize(TAB, {
        notifyOnFinish: false,
        selectionText: "too short",
      }),
    `Select at least ${MIN_SELECTION_LENGTH} characters to summarize.`,
    "too-short selection",
  );
});

test("runBackgroundSummarize throws when the active tab yields no page data (#253)", async () => {
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async () => null;
  try {
    await rejectsUserFacing(
      () => runBackgroundSummarize(TAB, { notifyOnFinish: false }),
      COULD_NOT_READ_THIS_PAGE_ERROR_MSG,
      "no page data",
    );
  } finally {
    chrome.tabs.sendMessage = original;
  }
});

test("runBackgroundSummarize throws when the page has no extractable content (#253)", async () => {
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async () => ({ isPdf: false, content: "" });
  try {
    await rejectsUserFacing(
      () => runBackgroundSummarize(TAB, { notifyOnFinish: false }),
      NOTHING_TO_SUMMARIZE_ERROR_MSG,
      "empty page content",
    );
  } finally {
    chrome.tabs.sendMessage = original;
  }
});

test("runBackgroundSummarize throws when a PDF is too large to process (#253)", async () => {
  const originalSend = chrome.tabs.sendMessage;
  const originalRuntimeSend = chrome.runtime.sendMessage;
  chrome.tabs.sendMessage = async () => ({
    isPdf: true,
    content: "",
    title: "Big PDF",
    url: TAB.url,
  });
  chrome.runtime.sendMessage = async () => ({
    error:
      "PDF_TOO_LARGE: This PDF is 99 MB, which exceeds the 20 MB limit for in-extension processing.",
  });
  try {
    await rejectsUserFacing(
      () => runBackgroundSummarize(TAB, { notifyOnFinish: false }),
      "This PDF is too large to process inside the extension. Try a shorter document.",
      "PDF too large",
    );
  } finally {
    chrome.tabs.sendMessage = originalSend;
    chrome.runtime.sendMessage = originalRuntimeSend;
  }
});

test("runBackgroundSummarize throws when no text can be extracted from a PDF (#253)", async () => {
  const originalSend = chrome.tabs.sendMessage;
  const originalRuntimeSend = chrome.runtime.sendMessage;
  chrome.tabs.sendMessage = async () => ({
    isPdf: true,
    content: "",
    title: "Scanned PDF",
    url: TAB.url,
  });
  chrome.runtime.sendMessage = async () => ({ text: "" });
  try {
    await rejectsUserFacing(
      () => runBackgroundSummarize(TAB, { notifyOnFinish: false }),
      COULD_NOT_EXTRACT_TEXT_FROM_PDF_ERROR_MSG,
      "empty PDF text",
    );
  } finally {
    chrome.tabs.sendMessage = originalSend;
    chrome.runtime.sendMessage = originalRuntimeSend;
  }
});

test("the orphaned notifyNothingToSummarize helper is gone (#253)", () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );
  assert.ok(
    !swCode.includes("notifyNothingToSummarize"),
    "notifyNothingToSummarize should be removed entirely now that every empty-content branch throws",
  );
});
