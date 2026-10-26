import test from "node:test";
import assert from "node:assert";
import { readSource, functionBody } from "../helpers/readSource.js";
import {
  customContentPromptsCacheKey,
  getSummaryAndPromptsCacheKeys,
  getUiPromptsCacheKey,
  restoreFocusKeyword,
  restorePromptsContext,
  savedSummaryRestorePlan,
} from "../../ui/promptsContext.js";
import {
  getPromptsCacheKey,
  getSummaryCacheKeyForSettings,
  hashUrl,
} from "../../lib/storage/pageCache.js";

// --- #497: suggested-prompts keys must survive the restore round trip ---
//
// The UI listens on a promptsCacheKey, the trusted finalizer stores questions
// under one, and a restore rebuilds one to ask for more. Any difference in
// provider, page type, or selected text strands the questions in a key nobody
// listens on. These tests pin the UI side of that contract.

const settings = {
  provider: "local",
  responseFormat: "bullets",
  summaryLanguage: "auto",
  customInstructions: "",
  translationEngine: "opus",
  localModel: "qwen3:8b",
  ollamaHost: "http://127.0.0.1:11434",
};
const model = "qwen3:8b";
const url = "https://example.com/prompts-context";
const noCachedPage = async () => null;
const appCode = readSource("../../ui/app.js", import.meta.url);

test("restored page type reproduces the generation-time prompts key (#497)", async () => {
  const generationKey = await getUiPromptsCacheKey(url, settings, model, "", {
    pageType: "article",
  });
  const context = await restorePromptsContext({
    url,
    state: { pageType: "article", promptsCacheKey: generationKey },
    currentPageData: null,
    loadCachedPage: noCachedPage,
  });

  assert.deepStrictEqual(context, { pageType: "article", selectionText: "" });
  assert.strictEqual(
    await getUiPromptsCacheKey(url, settings, model, "", context),
    generationKey,
  );
});

test("restored selection text reproduces the generation-time prompts key (#497)", async () => {
  const selectionText = "The board approved the merger after a long debate.";
  const generationContext = { pageType: "selection", selectionText };
  const generationKey = await getUiPromptsCacheKey(
    url,
    settings,
    model,
    "",
    generationContext,
  );

  const context = await restorePromptsContext({
    url,
    state: { pageType: "selection", isSelection: true, selectionText },
    currentPageData: null,
    loadCachedPage: noCachedPage,
  });

  assert.deepStrictEqual(context, generationContext);
  assert.strictEqual(
    await getUiPromptsCacheKey(url, settings, model, "", context),
    generationKey,
  );
});

test("a persisted empty page type is authoritative for custom content (#497)", async () => {
  const context = await restorePromptsContext({
    url,
    // Custom content persists pageType: ""; the tab itself is an article, so
    // falling through to its cached metadata would compute the wrong key.
    state: { pageType: "" },
    currentPageData: null,
    loadCachedPage: async () => {
      throw new Error("persisted page type must win");
    },
  });

  assert.deepStrictEqual(context, { pageType: "", selectionText: "" });
});

test("a non-selection page type wins over stale selection flags (#497)", async () => {
  const context = await restorePromptsContext({
    url,
    // A normal summary written after a selection can inherit the old flags.
    // The persisted page type is the authority: do not restore selection text
    // for an article.
    state: {
      pageType: "article",
      isSelection: true,
      selectionText: "Text selected before the article summary.",
    },
    currentPageData: null,
    loadCachedPage: noCachedPage,
  });

  assert.deepStrictEqual(context, { pageType: "article", selectionText: "" });
});

test("legacy selection state without a page type still restores selection (#497)", async () => {
  const selectionText = "Selected text from an older saved state.";
  const context = await restorePromptsContext({
    url,
    state: { isSelection: true, selectionText },
    currentPageData: null,
    loadCachedPage: noCachedPage,
  });

  assert.deepStrictEqual(context, { pageType: "selection", selectionText });
});

test("a restored summary keeps the focus keyword that scoped its key (#161)", () => {
  assert.strictEqual(
    restoreFocusKeyword({
      state: {
        pageType: "article",
        focusKeyword: "  battery pricing  ",
        promptsCacheKey: "suggested-prompts:key",
      },
    }),
    "battery pricing",
  );
  assert.strictEqual(
    restoreFocusKeyword({
      state: { pageType: "selection", focusKeyword: "merger terms" },
    }),
    "merger terms",
  );
});

test("restored focus keyword is empty for a multi-tab synthesis (#494)", () => {
  assert.strictEqual(
    restoreFocusKeyword({
      state: { pageType: "multi-tab", focusKeyword: "must not leak" },
    }),
    "",
  );
  assert.strictEqual(
    restoreFocusKeyword({
      state: { pageType: "article", focusKeyword: "must not leak" },
      multiTab: true,
    }),
    "",
    "a synthesis never carries the owner tab's keyword",
  );
});

test("restored focus keyword ignores non-string or missing state (#161)", () => {
  assert.strictEqual(restoreFocusKeyword({ state: null }), "");
  assert.strictEqual(
    restoreFocusKeyword({ state: { pageType: "article", focusKeyword: 42 } }),
    "",
  );
});

test("saved summary restore plan reuses the persisted key and focus keyword (#161)", () => {
  assert.deepStrictEqual(
    savedSummaryRestorePlan({
      state: {
        pageType: "article",
        promptsCacheKey: "suggested-prompts:stored-key",
        focusKeyword: "  battery pricing  ",
      },
      fallbackPromptsCacheKey: "suggested-prompts:rebuilt-key",
    }),
    {
      promptsCacheKey: "suggested-prompts:stored-key",
      useStored: true,
      focusKeyword: "battery pricing",
    },
  );
});

test("multi-tab saved summary plan rebuilds the key but skips stored prompts and focus (#494)", () => {
  assert.deepStrictEqual(
    savedSummaryRestorePlan({
      state: {
        pageType: "article",
        promptsCacheKey: null,
        focusKeyword: "must not leak",
      },
      fallbackPromptsCacheKey: "suggested-prompts:rebuilt-key",
    }),
    {
      promptsCacheKey: "suggested-prompts:rebuilt-key",
      useStored: false,
      focusKeyword: "",
    },
  );
});

test("saved summary restore plan tolerates legacy states and missing keys (#494)", () => {
  assert.deepStrictEqual(
    savedSummaryRestorePlan({
      state: {
        promptsCacheKey: "suggested-prompts:legacy-key",
        isSelection: true,
        focusKeyword: "merger terms",
      },
    }),
    {
      promptsCacheKey: "suggested-prompts:legacy-key",
      useStored: true,
      focusKeyword: "merger terms",
    },
    "a legacy state keeps its keyword unless the type is multi-tab",
  );
  assert.deepStrictEqual(savedSummaryRestorePlan(), {
    promptsCacheKey: null,
    useStored: false,
    focusKeyword: "",
  });
});

test("restore ignores another tab's in-memory page data (#497)", async () => {
  const context = await restorePromptsContext({
    url,
    state: null,
    currentPageData: {
      url: "https://example.com/other-tab",
      type: "video",
      content: "The other tab's text.",
    },
    loadCachedPage: async (requestedUrl) => {
      assert.strictEqual(requestedUrl, url);
      return { url, type: "article", content: "Cached article text." };
    },
  });

  assert.deepStrictEqual(context, { pageType: "article", selectionText: "" });
});

test("restore uses this tab's in-memory page type when no state exists (#497)", async () => {
  const context = await restorePromptsContext({
    url,
    state: null,
    currentPageData: { url, type: "video", content: "Video transcript." },
    loadCachedPage: async () => {
      throw new Error("in-memory data must win");
    },
  });

  assert.deepStrictEqual(context, { pageType: "video", selectionText: "" });
});

test("restore recovers selected text from this tab's in-memory selection (#497)", async () => {
  const selectionText = "Selected text held in the panel.";
  const context = await restorePromptsContext({
    url,
    // Older states can carry the flag without the text; the in-memory
    // selection belongs to this URL, so it is a safe source.
    state: { isSelection: true },
    currentPageData: { url, type: "selection", content: selectionText },
    loadCachedPage: noCachedPage,
  });

  assert.deepStrictEqual(context, { pageType: "selection", selectionText });
});

test("restore drops stale selection text and falls back safely (#497)", async () => {
  const context = await restorePromptsContext({
    url,
    state: null,
    currentPageData: {
      url: "https://example.com/other-tab",
      type: "selection",
      content: "A selection from the other tab.",
    },
    loadCachedPage: noCachedPage,
  });

  assert.deepStrictEqual(context, { pageType: "", selectionText: "" });
});

test("custom-content keys include the provider the finalizer uses (#497)", async () => {
  const content = "Pasted text that the trusted finalizer receives.";
  const identity = `local:${await hashUrl(content)}`;
  const expected = await getPromptsCacheKey(
    identity,
    model,
    settings.summaryLanguage,
    settings.customInstructions,
    settings.translationEngine,
    "",
    { providerType: "local", pageType: "" },
  );

  assert.strictEqual(
    await customContentPromptsCacheKey({ url: "", content, settings, model }),
    expected,
  );
});

test("summary keys stay response-format scoped while prompts keys do not (#498)", async () => {
  const bullets = { ...settings, responseFormat: "bullets" };
  const prose = { ...settings, responseFormat: "prose" };

  const bulletKeys = await getSummaryAndPromptsCacheKeys(
    url,
    bullets,
    model,
    "",
    { pageType: "article" },
  );
  const proseKeys = await getSummaryAndPromptsCacheKeys(url, prose, model, "", {
    pageType: "article",
  });

  assert.notStrictEqual(bulletKeys.cacheKey, proseKeys.cacheKey);
  assert.strictEqual(bulletKeys.promptsCacheKey, proseKeys.promptsCacheKey);
  assert.strictEqual(
    bulletKeys.cacheKey,
    await getSummaryCacheKeyForSettings(url, bullets, model, ""),
    "the UI keeps using the summary key builder unchanged",
  );
});

test("focus-keyword scoping still applies to both keys with page context (#161)", async () => {
  const withKeyword = await getSummaryAndPromptsCacheKeys(
    url,
    settings,
    model,
    "battery pricing",
    { pageType: "article" },
  );
  const withOther = await getSummaryAndPromptsCacheKeys(
    url,
    settings,
    model,
    "safety recalls",
    { pageType: "article" },
  );

  assert.notStrictEqual(withKeyword.cacheKey, withOther.cacheKey);
  assert.notStrictEqual(withKeyword.promptsCacheKey, withOther.promptsCacheKey);
});

test("different selections on one URL get different prompts keys (#497)", async () => {
  const first = await getUiPromptsCacheKey(url, settings, model, "", {
    pageType: "selection",
    selectionText: "The first selected paragraph.",
  });
  const second = await getUiPromptsCacheKey(url, settings, model, "", {
    pageType: "selection",
    selectionText: "A completely different paragraph.",
  });

  assert.notStrictEqual(first, second);
});

test("the custom-content UI builds its listen key through the provider-aware helper (#497)", () => {
  const body = functionBody(
    appCode,
    "summarizeCustomContent",
    'document.getElementById("pasteTextBtn")',
  );
  assert.match(body, /customContentPromptsCacheKey\(/);
  assert.ok(
    !body.includes("getPromptsCacheKeyForSettings("),
    "the custom-content path must not build a context-free key",
  );
});

test("the cached-summary restore resolves page context through the shared helper (#497)", () => {
  // The saved-state path already carries the key generation used; only the
  // cache-hit path has to rebuild context from storage and page data.
  const contextBlock = appCode.match(
    /const restoredContext = await restorePromptsContext\(\{[\s\S]*?\n\s*\}\);/,
  );
  assert.ok(
    contextBlock,
    "the cached-summary restore asks the shared helper for its context",
  );
});

test("the saved-summary restore uses the shared key and focus plan (#161)", () => {
  assert.match(
    appCode,
    /const restorePlan = savedSummaryRestorePlan\(\{[\s\S]*?state,[\s\S]*?fallbackPromptsCacheKey,/,
    "the saved-summary path must delegate to the tested helper",
  );
  assert.match(
    appCode,
    /restoreSuggestedPrompts\(\{\s*\.\.\.restorePlan,/,
    "the plan's key, stored-prompt guard, and keyword must reach the restore",
  );
});

test("restoreSuggestedPrompts forwards the resolved context to the suggest job (#497)", () => {
  const helper = functionBody(
    appCode,
    "restoreSuggestedPrompts",
    "chrome.storage.onChanged.addListener",
  );
  assert.match(
    helper,
    /startSuggestedQuestionsBg\([\s\S]*?pageType,\s*selectionText\s*\}/,
    "the helper must pass page type and selection text to the worker",
  );
  assert.match(
    helper,
    /startSuggestedQuestionsBg\([\s\S]*?persist,\s*focusKeyword,/,
    "the helper must pass the restored focus keyword",
  );
});
