import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  customContentPromptsCacheKey,
  getSummaryAndPromptsCacheKeys,
  getUiPromptsCacheKey,
  restorePromptsContext,
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
  const appCode = readFileSync(
    new URL("../../ui/app.js", import.meta.url),
    "utf8",
  );
  const body = appCode.match(
    /async function summarizeCustomContent\([\s\S]*?\n\}\n/,
  );
  assert.ok(body, "summarizeCustomContent function found");
  assert.match(body[0], /customContentPromptsCacheKey\(/);
  assert.ok(
    !body[0].includes("getPromptsCacheKeyForSettings("),
    "the custom-content path must not build a context-free key",
  );
});

test("restore paths resolve context through the shared helper (#497)", () => {
  const appCode = readFileSync(
    new URL("../../ui/app.js", import.meta.url),
    "utf8",
  );
  const restoreCalls = appCode.match(/restorePromptsContext\(/g) || [];
  assert.ok(
    restoreCalls.length >= 2,
    "both restored summaries and cached summaries must use the helper",
  );
});

test("the restored-summary suggest call passes the resolved context (#497)", () => {
  const appCode = readFileSync(
    new URL("../../ui/app.js", import.meta.url),
    "utf8",
  );
  const r1Call = appCode.match(
    /startSuggestedQuestionsBg\(\s*selPromptsKey,[\s\S]*?\n\s*\);/,
  );
  assert.ok(r1Call, "restored-summary suggest call found");
  assert.match(
    r1Call[0],
    /\.\.\.restoredContext/,
    "the R1 call must pass the resolved page type and selection text",
  );
  assert.match(
    r1Call[0],
    /restoredFocusKeyword/,
    "the R1 call must pass the persisted focus keyword",
  );
});
