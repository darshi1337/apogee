export function createPastSummariesController({
  readIndex,
  readTexts,
  search,
  renderRecent,
  renderResults,
  clearSearchCache,
  onError,
  recentCount = 8,
  debounceMs = 150,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let activeRun = null;
  let timeout = null;

  function invalidate({ clearCache = false } = {}) {
    cancel(timeout);
    timeout = null;
    activeRun?.abort();
    activeRun = null;
    if (clearCache) clearSearchCache();
  }

  function begin() {
    invalidate();
    activeRun = new AbortController();
    return activeRun.signal;
  }

  async function loadRecent() {
    const signal = begin();
    const cacheOrder = await readIndex();
    if (signal.aborted) return;
    const recent = cacheOrder.slice(-recentCount).reverse();
    const stored = await readTexts(recent);
    if (signal.aborted) return;
    renderRecent(recent, stored);
  }

  async function runSearch(query, signal) {
    if (signal.aborted) return;
    const cacheOrder = await readIndex();
    if (signal.aborted) return;
    const stored = await readTexts(cacheOrder);
    if (signal.aborted) return;
    const options = {
      query,
      cacheOrder,
      storedSummaries: stored,
      signal,
    };
    const keywords = await search({ ...options, embedTextsFn: null });
    if (signal.aborted) return;
    renderResults(keywords, stored);
    if (signal.aborted) return;
    const semantic = await search(options);
    if (signal.aborted) return;
    renderResults(semantic, stored);
  }

  async function searchNow(query) {
    const q = (query || "").trim();
    if (!q) return loadRecent();
    return runSearch(q, begin());
  }

  function input(query) {
    const q = (query || "").trim();
    if (!q) {
      loadRecent().catch(onError);
      return;
    }
    // Abort before the debounce window so an older semantic result cannot flash.
    const signal = begin();
    timeout = schedule(() => {
      timeout = null;
      runSearch(q, signal).catch(onError);
    }, debounceMs);
  }

  return { invalidate, loadRecent, searchNow, input };
}
