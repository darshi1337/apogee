import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { UserFacingError } from "../../lib/util/userError.js";
import {
  COULD_NOT_READ_THIS_PAGE_ERROR_MSG,
  NOTHING_TO_SUMMARIZE_ERROR_MSG,
} from "../../lib/util/messages.js";

const { chrome } = createExtensionApiMock({ settings: {} });
chrome.scripting = {
  executeScript: async ({ func }) => {
    if (String(func).includes("__apogeeExtractorVersion")) {
      return [{ result: chrome.runtime.getManifest().version }];
    }
    return [{ result: "JVBERi0xLjQK" }];
  },
};
globalThis.chrome = chrome;

const { runExtractOnly } = await import(
  "../../background/service-worker.js"
);

const TAB = {
  id: 1,
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
    `${label}: expected a throw but the call resolved`,
  );
  assert.ok(
    thrown instanceof UserFacingError,
    `${label}: expected UserFacingError, got ${
      thrown && thrown.constructor.name
    }`,
  );
  if (expectedMessage) {
    assert.strictEqual(thrown.message, expectedMessage, `${label}: message`);
  }
}

test.beforeEach(async () => {
  await chrome.storage.local.clear();
});

test("runExtractOnly returns payload with cleaned text on success (#414)", async () => {
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async () => ({
    title: "Example Article",
    url: TAB.url,
    content: "  Hello   world article text.\n\n\n\nAnother line.  ",
    type: "article",
    isPdf: false,
  });
  try {
    const result = await runExtractOnly(TAB);
    assert.strictEqual(
      result.content,
      "Hello world article text.\n\nAnother line.",
    );
    assert.strictEqual(result.title, "Example Article");
    assert.strictEqual(result.url, TAB.url);
    assert.strictEqual(result.type, "article");
    assert.strictEqual(result.isPdf, false);
  } finally {
    chrome.tabs.sendMessage = original;
  }
});

test("runExtractOnly throws UserFacingError when active tab yields no page data (#414)", async () => {
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async () => null;
  try {
    await rejectsUserFacing(
      () => runExtractOnly(TAB),
      COULD_NOT_READ_THIS_PAGE_ERROR_MSG,
      "no page data",
    );
  } finally {
    chrome.tabs.sendMessage = original;
  }
});

test("runExtractOnly throws UserFacingError when extracted content is empty (#414)", async () => {
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async () => ({
    title: "Example",
    url: TAB.url,
    content: "",
    type: "article",
    isPdf: false,
  });
  try {
    await rejectsUserFacing(
      () => runExtractOnly(TAB),
      NOTHING_TO_SUMMARIZE_ERROR_MSG,
      "empty content",
    );
  } finally {
    chrome.tabs.sendMessage = original;
  }
});

test("runExtractOnly throws UserFacingError when cleaned content reduces to whitespace (#414)", async () => {
  const original = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async () => ({
    title: "Whitespace Only",
    url: TAB.url,
    content: "   \n\n   \t  \n  ",
    type: "article",
    isPdf: false,
  });
  try {
    await rejectsUserFacing(
      () => runExtractOnly(TAB),
      NOTHING_TO_SUMMARIZE_ERROR_MSG,
      "whitespace-only content",
    );
  } finally {
    chrome.tabs.sendMessage = original;
  }
});

test("runExtractOnly statically contains no model or stream calls (#414)", () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );

  const fnMatch = swCode.match(
    /export async function runExtractOnly[\s\S]*?\n\}/,
  );
  assert.ok(fnMatch, "runExtractOnly function found in service-worker.js");
  const fnBody = fnMatch[0];

  const forbiddenCalls = [
    "startLocalHttpStream",
    "startTransformersStream",
    "summarizeText",
    "chatStream",
  ];

  for (const forbidden of forbiddenCalls) {
    assert.ok(
      !fnBody.includes(forbidden),
      `runExtractOnly must not call ${forbidden}`,
    );
  }
});

test("runExtractOnly never calls any stream or model action at runtime (#414)", async () => {
  const originalSend = chrome.tabs.sendMessage;
  const originalRuntime = chrome.runtime.sendMessage;
  const modelActions = [];
  chrome.runtime.sendMessage = async (msg) => {
    const action = msg?.action;
    if (
      action === "ollama-stream" ||
      action === "llamacpp-stream" ||
      action === "transformers-stream" ||
      action === "summarize"
    ) {
      modelActions.push(action);
    }
    return originalRuntime(msg);
  };
  chrome.tabs.sendMessage = async () => ({
    title: "Test",
    url: TAB.url,
    content: "Some page content to extract.",
    type: "article",
    isPdf: false,
  });
  try {
    await runExtractOnly(TAB);
    assert.strictEqual(
      modelActions.length,
      0,
      `runExtractOnly must not trigger any model action, got: ${modelActions.join(", ")}`,
    );
  } finally {
    chrome.tabs.sendMessage = originalSend;
    chrome.runtime.sendMessage = originalRuntime;
  }
});
