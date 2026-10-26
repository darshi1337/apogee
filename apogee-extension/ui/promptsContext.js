import { getProviderType } from "../lib/engines/providers.js";
import { gateFocusKeyword } from "./focusKeyword.js";
import {
  getCachedContent,
  getPromptsCacheKeyForSettings,
  getSummaryCacheKeyForSettings,
  hashUrl,
} from "../lib/storage/pageCache.js";

// The suggested-prompts key has dimensions the summary key does not: the
// provider that generated the summary, the page type, and, for a selection, a
// hash of the selected text. The trusted finalizer includes them, so every UI
// path must include them too or the questions land under a key the UI never
// listens on (#497).
export function promptsKeyContext(
  settings,
  { pageType = "", selectionText = "" } = {},
) {
  return {
    providerType: getProviderType(settings),
    pageType,
    // The key builder ignores a selection hash without the selection page
    // type; keep the context honest at the source as well.
    selectionText: pageType === "selection" ? selectionText : "",
  };
}

export async function getUiPromptsCacheKey(
  identityUrl,
  settings,
  model,
  focusKeyword = "",
  context = {},
) {
  return getPromptsCacheKeyForSettings(
    identityUrl,
    settings,
    model,
    focusKeyword,
    promptsKeyContext(settings, context),
  );
}

export async function getSummaryAndPromptsCacheKeys(
  url,
  settings,
  model,
  focusKeyword = "",
  context = {},
) {
  return {
    cacheKey: await getSummaryCacheKeyForSettings(
      url,
      settings,
      model,
      focusKeyword,
    ),
    promptsCacheKey: await getUiPromptsCacheKey(
      url,
      settings,
      model,
      focusKeyword,
      context,
    ),
  };
}

// Pasted content has no page type; its identity is the source URL when there
// is one, else a hash of the text (mirrors buildTrustedFinalize).
export async function customContentPromptsCacheKey({
  url,
  content,
  settings,
  model,
  focusKeyword = "",
}) {
  const identityUrl = url || `local:${await hashUrl(content)}`;
  return getUiPromptsCacheKey(identityUrl, settings, model, focusKeyword, {
    pageType: "",
  });
}

// A restored summary must regenerate its questions with the same focus
// keyword that scoped the key, even though the live input is empty on a fresh
// popup. The keyword rides in view state; multi-tab syntheses never use one.
export function restoreFocusKeyword({ state = null, multiTab = false } = {}) {
  if (multiTab) return "";
  const raw = typeof state?.focusKeyword === "string" ? state.focusKeyword : "";
  return gateFocusKeyword(raw, state?.pageType);
}

// Decide which key and focus keyword a restored summary uses. A real persisted
// key owns its stored prompts; a multi-tab synthesis saves null and rebuilds
// the owner URL's single-tab key only to match the worker's broadcast, so it
// must neither read stored prompts nor inherit a keyword (#494).
export function savedSummaryRestorePlan({
  state = null,
  fallbackPromptsCacheKey = null,
} = {}) {
  const isMultiTab = !state?.promptsCacheKey;
  return {
    promptsCacheKey: state?.promptsCacheKey || fallbackPromptsCacheKey,
    useStored: !isMultiTab,
    focusKeyword: restoreFocusKeyword({ state, multiTab: isMultiTab }),
  };
}

// Restore has to rebuild the same context the generation run used. Persisted
// view state is authoritative (an empty pageType is meaningful for pasted
// content). Older states have no pageType, so fall back to in-memory data that
// provably belongs to this URL, then the content cache for this URL. Never
// borrow page data from another tab.
export async function restorePromptsContext({
  url,
  state = null,
  currentPageData = null,
  loadCachedPage = getCachedContent,
}) {
  const inMemory =
    currentPageData && currentPageData.url === url ? currentPageData : null;
  const hasStatePageType = typeof state?.pageType === "string";
  // A persisted page type is authoritative, including the empty one custom
  // content writes. The legacy isSelection flag only decides for older states
  // that predate pageType; otherwise a stale flag from a prior selection could
  // relabel a normal article.
  const stateIsSelection = hasStatePageType
    ? state.pageType === "selection"
    : Boolean(state?.isSelection);

  let pageType;
  if (stateIsSelection) {
    pageType = "selection";
  } else if (hasStatePageType) {
    pageType = state.pageType;
  } else if (inMemory) {
    pageType = inMemory.type || "";
  } else {
    pageType = (await loadCachedPage(url))?.type || "";
  }

  let selectionText =
    typeof state?.selectionText === "string" ? state.selectionText : "";
  if (
    !selectionText &&
    pageType === "selection" &&
    inMemory?.type === "selection"
  ) {
    selectionText = inMemory.content || "";
  }

  return {
    pageType,
    selectionText: pageType === "selection" ? selectionText : "",
  };
}
