import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import fs from "node:fs";
import { parseHTML } from "linkedom";
import {
  CUSTOM_INSTRUCTIONS_MAX_CHARS,
  MODEL_NAME_MAX_CHARS,
  PRIVATE_HOSTS_MAX_CHARS,
} from "../../lib/constants.js";
import { FOCUS_KEYWORD_MAX_CHARS } from "../../lib/summarize/prompts.js";

// #161: a per-page focus keyword input. app.js relies on chrome.* tab events
// and DOM state that this repo doesn't execute in tests (see
// popupMessageGate.test.js / validateLoopbackHost.test.js) - so, like those,
// the behavioral assertions here are source-text inspections rather than a
// live DOM run.

const appHtmlPath = new URL("../../ui/app.html", import.meta.url);
const appHtmlRaw = readFileSync(appHtmlPath, "utf8");

const appCode = fs.readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf-8",
);

test("app.html declares the focus keyword input with the documented cap (#161)", () => {
  const { document } = parseHTML(appHtmlRaw);
  const input = document.getElementById("focusKeywordInput");
  assert.ok(input, "#focusKeywordInput must exist in app.html");
  assert.strictEqual(input.getAttribute("type"), "text");
  // #320: assert against the JS cap, not a literal, so bumping
  // FOCUS_KEYWORD_MAX_CHARS fails here instead of silently drifting.
  assert.strictEqual(
    input.getAttribute("maxlength"),
    String(FOCUS_KEYWORD_MAX_CHARS),
  );
});

test("capped settings inputs match their JS caps (#320)", () => {
  const { document } = parseHTML(appHtmlRaw);
  const customInstructions = document.getElementById("customInstructionsInput");
  assert.ok(customInstructions, "#customInstructionsInput must exist");
  assert.strictEqual(
    customInstructions.getAttribute("maxlength"),
    String(CUSTOM_INSTRUCTIONS_MAX_CHARS),
  );
  const privateHosts = document.getElementById("privateHostsInput");
  assert.ok(privateHosts, "#privateHostsInput must exist");
  assert.strictEqual(
    privateHosts.getAttribute("maxlength"),
    String(PRIVATE_HOSTS_MAX_CHARS),
  );
  const llamaModel = document.getElementById("llamaModelInput");
  assert.ok(llamaModel, "#llamaModelInput must exist");
  assert.strictEqual(
    llamaModel.getAttribute("maxlength"),
    String(MODEL_NAME_MAX_CHARS),
  );
});

test("app.js syncs each capped input maxlength from its JS constant (#320)", () => {
  assert.match(
    appCode,
    /import \{[\s\S]*?FOCUS_KEYWORD_MAX_CHARS[\s\S]*?\} from "\.\.\/lib\/summarize\/prompts\.js"/,
  );
  // One helper + one sync site, so a new capped input cannot half-wire
  // its maxlength.
  assert.match(appCode, /function setInputMaxLength\(input, maxChars\)/);
  assert.match(appCode, /function syncCappedInputMaxLengths\(\)/);
  for (const [input, cap] of [
    ["focusKeywordInput", "FOCUS_KEYWORD_MAX_CHARS"],
    ["customInstructionsInput", "CUSTOM_INSTRUCTIONS_MAX_CHARS"],
    ["privateHostsInput", "PRIVATE_HOSTS_MAX_CHARS"],
    ["llamaModelInput", "MODEL_NAME_MAX_CHARS"],
  ]) {
    assert.ok(
      appCode.includes(`setInputMaxLength(${input}, ${cap})`),
      `expected setInputMaxLength(${input}, ${cap}) in syncCappedInputMaxLengths`,
    );
  }
});

test("capped settings counters and autosave share one helper (#320)", () => {
  assert.match(
    appCode,
    /function updateCappedInputCount\(input, countEl, maxChars\)/,
  );
  assert.match(
    appCode,
    /function wireCappedSettingsInput\(input, countEl, maxChars, settingKey\)/,
  );
  for (const [fnName, cap, key] of [
    [
      "updateCustomInstructionsCount",
      "CUSTOM_INSTRUCTIONS_MAX_CHARS",
      "customInstructions",
    ],
    ["updatePrivateHostsCount", "PRIVATE_HOSTS_MAX_CHARS", "privateHosts"],
  ]) {
    const fnMatch = appCode.match(
      new RegExp(`function ${fnName}[\\s\\S]*?\\n\\}`),
    );
    assert.ok(fnMatch, `${fnName} function found`);
    assert.ok(
      fnMatch[0].includes("updateCappedInputCount(") &&
        fnMatch[0].includes(cap),
      `expected ${fnName} to delegate to updateCappedInputCount with ${cap}`,
    );
    assert.ok(
      appCode.includes(`"${key}"`),
      `expected wireCappedSettingsInput to persist the ${key} key`,
    );
  }
  assert.doesNotMatch(appCode, /persistCustomInstructions|persistPrivateHosts/);
});

test("the focus keyword input is cleared on same-tab navigation to a new URL (#161)", () => {
  const onUpdatedMatch = appCode.match(
    /chrome\.tabs\.onUpdated\.addListener\(\(tabId, changeInfo\) => \{[\s\S]*?\n\}\);/,
  );
  assert.ok(onUpdatedMatch, "chrome.tabs.onUpdated listener found");
  const body = onUpdatedMatch[0];
  assert.match(body, /changeInfo\.url/);
  assert.match(body, /tabId !== activeTabId/);
  assert.match(body, /clearFocusKeyword\(\)/);
});

test("re-summarizing the same page does not clear the focus keyword (#161)", () => {
  const line = appCode
    .split("\n")
    .find((l) => l.includes('resummarizeBtn?.addEventListener("click"'));
  assert.ok(line, "resummarizeBtn click handler found");
  assert.doesNotMatch(line, /focusKeywordInput\.value/);
});

test("the focus keyword input is hidden on multi-tab pages only - video and discussion honor it (#388)", () => {
  // Single source of truth lives in isFocusKeywordSupportedType (#319).
  const helperMatch = appCode.match(
    /function isFocusKeywordSupportedType[\s\S]*?\n\}/,
  );
  assert.ok(helperMatch, "isFocusKeywordSupportedType function found");
  const helperBody = helperMatch[0];
  assert.ok(
    helperBody.includes('"multi-tab"'),
    'expected "multi-tab" in the support check',
  );
  assert.doesNotMatch(helperBody, /isVideoType/);
  assert.doesNotMatch(helperBody, /isDiscussionType/);

  // Must actually be wired into the shared page-type resolver so every
  // existing (and future) call site stays in sync automatically.
  const chipFnMatch = appCode.match(/function updateExtractorChip[\s\S]*?\n\}/);
  assert.ok(chipFnMatch, "updateExtractorChip function found");
  assert.match(
    chipFnMatch[0],
    /isFocusKeywordSupportedType\(pageData\?\.type\)/,
  );
  assert.doesNotMatch(chipFnMatch[0], /updateFocusKeywordAvailability/);
});

test("summarizeActivePage gates the focus keyword on page-type support (#319)", () => {
  // The trim+gate lives in getGatedFocusKeyword so the write and restore
  // paths cannot drift; the raw input value never reaches cache keys.
  const helperMatch = appCode.match(
    /function getGatedFocusKeyword[\s\S]*?\n\}/,
  );
  assert.ok(helperMatch, "getGatedFocusKeyword helper found");
  assert.match(
    helperMatch[0],
    /\(focusKeywordInput\?\.value \|\| ""\)\.trim\(\)/,
  );
  assert.ok(
    helperMatch[0].includes("isFocusKeywordSupportedType("),
    "helper gates on page-type support",
  );
  assert.doesNotMatch(appCode, /const requestedFocusKeyword/);

  const start = appCode.indexOf("async function summarizeActivePage()");
  assert.ok(start !== -1, "summarizeActivePage function found");
  const body = appCode.slice(start);

  // The gate must land before the cache keys and the job payload, so
  // video/discussion jobs and keys never carry the keyword.
  const gateIdx = body.indexOf("getGatedFocusKeyword(pageData");
  assert.ok(gateIdx !== -1, "gated helper used in summarizeActivePage");
  const cacheIdx = body.indexOf("getSummaryCacheKeys(");
  const summarizeIdx = body.indexOf("provider.summarize({");
  assert.ok(cacheIdx > gateIdx, "cache keys computed after the gate");
  assert.ok(summarizeIdx > gateIdx, "summarize job sent after the gate");

  const cacheWindow = body.slice(cacheIdx, cacheIdx + 300);
  assert.ok(cacheWindow.includes("focusKeyword"), "gated focusKeyword used");
});

test("[#370] resetting the focus keyword input in a function clearFocusKeyword() helper", () => {
  const onActivatedMatch = appCode.match(
    /chrome\.tabs\.onActivated\.addListener\(\(\) => \{[\s\S]*?\n {4}\}\);/,
  );
  const onUpdatedMatch = appCode.match(
    /chrome\.tabs\.onUpdated\.addListener\(\([\s\S]*?\) => \{[\s\S]*?\n {2}\}\);/,
  );
  assert.ok(onActivatedMatch, "chrome.tabs.onActivated listener found");
  assert.ok(onUpdatedMatch, "chrome.tabs.onUpdated listener found");

  assert.match(onActivatedMatch[0], /clearFocusKeyword\(\)/);
  assert.match(onUpdatedMatch[0], /clearFocusKeyword\(\)/);

  assert.doesNotMatch(
    onActivatedMatch[0],
    /if \(focusKeywordInput\) focusKeywordInput\.value = ""/,
  );
  assert.doesNotMatch(
    onUpdatedMatch[0],
    /if \(focusKeywordInput\) focusKeywordInput\.value = ""/,
  );

  const helperMatch = appCode.match(
    /function clearFocusKeyword\(\) \{[\s\S]*?\n\}/,
  );
  assert.ok(helperMatch, "clearFocusKeyword helper found");
  assert.match(helperMatch[0], /focusKeywordInput\.value = ""/);
});

test("[#391] restoreTabView reuses the gated focus keyword and shared cache keys", () => {
  const helperMatch = appCode.match(
    /async function getSummaryCacheKeys[\s\S]*?\n\}/,
  );
  assert.ok(helperMatch, "getSummaryCacheKeys helper found");
  assert.ok(
    helperMatch[0].includes("getSummaryCacheKey("),
    "helper computes the summary key",
  );
  assert.ok(
    helperMatch[0].includes("getPromptsCacheKeyForSettings("),
    "helper computes the prompts key via the shared settings helper",
  );

  const start = appCode.indexOf("async function restoreTabView(");
  assert.ok(start !== -1, "restoreTabView function found");
  const body = appCode.slice(start);

  const gateIdx = body.indexOf("getGatedFocusKeyword(currentPageData");
  assert.ok(gateIdx !== -1, "gated helper used in restoreTabView");
  const cacheIdx = body.indexOf("getSummaryCacheKeys(");
  assert.ok(cacheIdx > gateIdx, "cache keys computed after the gate");
});
