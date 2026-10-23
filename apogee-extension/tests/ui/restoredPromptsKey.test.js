import test from "node:test";
import assert from "node:assert";
import { readSource } from "../helpers/readSource.js";

// --- #494: restored multi-tab summary leaves suggested-prompts spinner stuck ---
//
// Multi-tab saves promptsCacheKey: null (service-worker.js). On restore the
// popup used to pass that null into startSuggestedQuestionsBg, so
// currentPromptsCacheKey stayed null while the worker rebuilt a URL key and
// broadcast suggested-prompts-ready with it. The listener then dropped the
// message and the spinner never cleared.
//
// The rebuilt key is the exact single-tab key for the owner URL, so it must
// only be used to match the broadcast: reading it from storage would let a
// cached single-tab summary supply prompts for the multi-tab synthesis.

const appCode = readSource("../../ui/app.js", import.meta.url);

function restoreCall() {
  const match = appCode.match(
    /const isMultiTab = !state\.promptsCacheKey;([\s\S]*?)useStored: !isMultiTab,/,
  );
  assert.ok(
    match,
    "restore path still derives isMultiTab from state.promptsCacheKey",
  );
  return match[1];
}

test("restored summary rebuilds a null promptsCacheKey before suggesting (#494)", () => {
  assert.match(
    restoreCall(),
    /getPromptsCacheKeyForSettings/,
    "null saved key must be rebuilt from the tab URL before listening",
  );
});

test("restored multi-tab summary never reads the rebuilt key from storage", () => {
  assert.match(
    restoreCall(),
    /persist: false/,
    "a multi-tab restore must not persist prompts under the single-tab key",
  );
  const helper = appCode.match(
    /async function restoreSuggestedPrompts\(\{([\s\S]*?)\r?\n\}\r?\n/,
  );
  assert.ok(helper, "restoreSuggestedPrompts helper exists");
  assert.match(
    helper[1],
    /if \(useStored && promptsCacheKey\) \{[\s\S]*?chrome\.storage\.local\.get\(promptsCacheKey\)/,
    "the storage read is guarded by useStored",
  );
});

test("restored multi-tab summary asks for prompts with an empty focus keyword", () => {
  const rebuilt = restoreCall();
  assert.match(rebuilt, /getModelForSettings\(settings\),\s*"",/);
  assert.doesNotMatch(
    rebuilt,
    /getGatedFocusKeyword|currentPageData\?\.type/,
    "a stale page type on restore must not leak a focus keyword",
  );
});

test("the stored-prompts-else-generate block lives in one helper", () => {
  const generators = appCode.match(/startSuggestedQuestionsBg\(/g) || [];
  // the definition, the helper's call, and nothing else
  assert.strictEqual(generators.length, 2);
  assert.strictEqual(
    (appCode.match(/await restoreSuggestedPrompts\(\{/g) || []).length,
    2,
    "both restore paths go through restoreSuggestedPrompts",
  );
});
