import test from "node:test";
import assert from "node:assert";
import { readSource, functionBody } from "../helpers/readSource.js";
import { savedSummaryRestorePlan } from "../../ui/promptsContext.js";

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
const multiTabState = {
  promptsCacheKey: null,
  pageType: "article",
  focusKeyword: "must not leak",
};

test("restored summary rebuilds a null promptsCacheKey before suggesting (#494)", () => {
  const plan = savedSummaryRestorePlan({
    state: multiTabState,
    fallbackPromptsCacheKey: "suggested-prompts:rebuilt-key",
  });
  assert.strictEqual(plan.promptsCacheKey, "suggested-prompts:rebuilt-key");
  assert.strictEqual(plan.useStored, false);
});

test("restored multi-tab summary never reads the rebuilt key from storage", () => {
  const plan = savedSummaryRestorePlan({
    state: multiTabState,
    fallbackPromptsCacheKey: "suggested-prompts:rebuilt-key",
  });
  assert.strictEqual(
    plan.useStored,
    false,
    "a multi-tab restore must not read prompts under the single-tab key",
  );
  const helper = functionBody(
    appCode,
    "restoreSuggestedPrompts",
    "chrome.storage.onChanged.addListener",
  );
  assert.match(
    helper,
    /if \(useStored && promptsCacheKey\) \{[\s\S]*?chrome\.storage\.local\.get\(promptsCacheKey\)/,
    "the storage read is guarded by useStored",
  );
});

test("restored multi-tab summary asks for prompts with an empty focus keyword", () => {
  const plan = savedSummaryRestorePlan({
    state: multiTabState,
    fallbackPromptsCacheKey: "suggested-prompts:rebuilt-key",
  });
  assert.strictEqual(plan.focusKeyword, "");
});

test("the stored-prompts-else-generate block lives in one helper", () => {
  const generators = appCode.match(/startSuggestedQuestionsBg\(/g) || [];
  // the definition and the helper's call, and nothing else
  assert.strictEqual(generators.length, 2);
  assert.strictEqual(
    (appCode.match(/await restoreSuggestedPrompts\(\{/g) || []).length,
    2,
    "both restore paths go through restoreSuggestedPrompts",
  );
});
