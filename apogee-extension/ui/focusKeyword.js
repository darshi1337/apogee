// Focus-keyword helpers: pure logic for the per-page keyword input, with
// no DOM or chrome dependencies so plain Node tests drive them directly.
// app.js keeps thin wrappers that read the live input element.
// Only multi-tab pages skip the keyword-focus prompt path: the multi-tab
// synthesis uses buildMultiTabSummaryPrompt (no focusKeyword param - see
// background/service-worker.js). Video goes through summarizeYoutube and
// discussion threads go through the discussion prompts, both of which honor
// focusKeyword (see lib/summarize/ollamaSummarize.js).
export function isFocusKeywordSupportedType(type) {
  return type !== "multi-tab";
}

// Gate on type support (#319): a value typed before the type resolves (or
// left over) must not fragment the cache or ride along in job payloads
// the prompt path ignores.
export function gateFocusKeyword(rawValue, pageType) {
  const requested = (rawValue || "").trim();
  return isFocusKeywordSupportedType(pageType) ? requested : "";
}

// One page-change check for the navigation listener and the restore path:
// report a move when the tab or URL changed so the caller clears a
// leftover keyword, and stay quiet on a same-page re-render.
export function createKeywordPageTracker({ onClear } = {}) {
  let lastTabId = null;
  let lastUrl = null;
  return {
    handlePageChange(tabId, url) {
      const moved = tabId !== lastTabId || url !== lastUrl;
      if (moved) onClear?.();
      lastTabId = tabId ?? null;
      lastUrl = url ?? null;
      return moved;
    },
  };
}
