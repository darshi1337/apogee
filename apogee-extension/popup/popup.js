// Only load the dev-only chrome.* shim when running outside a real
// extension context (e.g. popup.html opened directly in a browser tab for
// UI iteration). In the shipped extension chrome.runtime.sendMessage is
// always defined, so this branch — and the network fetch for mock.js it
// would trigger — never runs for real users.
if (
  typeof chrome === "undefined" ||
  !chrome.runtime ||
  !chrome.runtime.sendMessage
) {
  await import("./mock.js");
}

import { getProvider, attachToStream } from "../lib/providers.js";
import {
  PROVIDERS,
  DEFAULT_SETTINGS,
  WEBLLM_MODELS,
  DEFAULT_LOCAL_API_BASE,
} from "../lib/constants.js";

const summarizeBtn = document.getElementById("summarizeBtn");
const summaryText = document.getElementById("summaryText");
const settingsBtn = document.getElementById("settingsBtn");
const settingsBtn2 = document.getElementById("settingsBtn2");
const closeBtn = document.getElementById("closeBtn");
const closeBtn2 = document.getElementById("closeBtn2");
const closeBtn3 = document.getElementById("closeBtn3");
const closeBtn4 = document.getElementById("closeBtn4");
const homeView = document.getElementById("homeView");
const summaryView = document.getElementById("summaryView");
const settingsView = document.getElementById("settingsView");
const summaryCard = document.getElementById("summaryCard");
const promptsSection = document.getElementById("promptsSection");
const chatSection = document.querySelector(".chat-section");
const questionHeading = document.getElementById("questionHeading");
const answerHeading = document.getElementById("answerHeading");
const questionInput = document.getElementById("questionInput");
const sendBtn = document.getElementById("sendBtn");
const answerBox = document.getElementById("answerBox");
const formatRadios = document.querySelectorAll('input[name="format"]');
const providerRadios = document.querySelectorAll('input[name="provider"]');
const localModelRadios = document.querySelectorAll('input[name="localModel"]');
const themeRadios = document.querySelectorAll('input[name="theme"]');
const backendUrlInput = document.getElementById("backendUrlInput");
const promptsCloseBtn = document.querySelector(".prompts-toggle");
const togglePromptsBtn = document.getElementById("togglePromptsBtn");
const getInTouchBtn = document.getElementById("getInTouchBtn");
const contactView = document.getElementById("contactView");
const settingsBackBtn = document.getElementById("settingsBackBtn");
const contactBackBtn = document.getElementById("contactBackBtn");
const webllmModelsCard = document.getElementById("webllmModelsCard");
const localSettingsCard = document.getElementById("localSettingsCard");
const localModelsCard = document.getElementById("localModelsCard");
const webllmModelList = document.getElementById("webllmModelList");
const webgpuWarning = document.getElementById("webgpuWarning");
const modelProgress = document.getElementById("modelProgress");
const modelProgressText = document.getElementById("modelProgressText");
const modelProgressPercent = document.getElementById("modelProgressPercent");
const modelProgressFill = document.getElementById("modelProgressFill");
const providerSettingsCard = document.getElementById("providerSettingsCard");
const toggleDebugLogsBtn = document.getElementById("toggleDebugLogsBtn");
const debugLogsCard = document.getElementById("debugLogsCard");
const debugLogsContent = document.getElementById("debugLogsContent");
const clearDebugLogsBtn = document.getElementById("clearDebugLogsBtn");
const saveHistoryRadios = document.querySelectorAll('input[name="saveHistory"]');
const clearDataBtn = document.getElementById("clearDataBtn");
const clearDataStatus = document.getElementById("clearDataStatus");

let currentPageData = null;
let currentSummaryText = "";

// The tab the popup is currently associated with. Set once on
// DOMContentLoaded and reused by view-state persistence below — the popup
// doesn't follow tab switches while it's open.
let activeTabId = null;

// The prompts-cache key the storage listener below is currently watching for.
// See runSuggestQuestionsJob in service-worker.js.
let currentPromptsCacheKey = null;

// Kicks off suggested-question generation as a background job. When `persist`
// is true the result is cached (and delivered via storage.onChanged, so a
// reopened popup still gets it); when false it's kept ephemeral and delivered
// only via the runtime message below to a still-open popup.
function startSuggestedQuestionsBg(promptsCacheKey, { title, url, summary }, settings, persist = true) {
  currentPromptsCacheKey = promptsCacheKey;
  const isFirefox = process.env.TARGET_BROWSER === "firefox";
  const providerType =
    isFirefox || settings.provider === PROVIDERS.LOCAL ? "local" : "webllm";
  chrome.runtime
    .sendMessage({
      target: "service-worker",
      action: "suggest-questions-bg",
      payload: {
        promptsCacheKey,
        persist,
        providerType,
        apiBase: settings.localApiBase,
        title,
        url,
        summary,
        model: getModelForSettings(settings),
      },
    })
    .catch(() => {});
}

// Renders suggested prompts when the background job persists them to storage
// (covers the reopen-while-generating case).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !currentPromptsCacheKey) return;
  const change = changes[currentPromptsCacheKey];
  if (!change) return;
  const questions = Array.isArray(change.newValue) ? change.newValue : [];
  setSuggestedQuestions(questions);
});

// Direct delivery from the background job — the only path when prompts aren't
// persisted (history off / sensitive host), and a fast path when they are.
chrome.runtime.onMessage.addListener((message) => {
  if (
    message.type === "suggested-prompts-ready" &&
    message.promptsCacheKey === currentPromptsCacheKey
  ) {
    setSuggestedQuestions(
      Array.isArray(message.questions) ? message.questions : [],
    );
  }
});

// Persists which "page" of the popup the user was last on (plus enough
// state to resume an in-flight summarize/ask stream) so reopening the
// popup — which fully destroys and recreates this script every time —
// lands back where the user left off instead of always resetting to home.
function viewStateKey(tabId) {
  return `popupViewState:${tabId}`;
}

// Cap retained per-tab view states (each is keyed by tabId and can hold
// answer/summary text) with an oldest-first FIFO, like the other caches.
const MAX_VIEW_STATES = 50;

async function saveViewState(tabId, partial) {
  if (tabId == null) return null;
  // Page-specific states carry a `url` (summary/answer/ask resume state);
  // pure app-navigation states (settings/home/contact) don't. Skip persisting
  // the former when the page isn't persistable, so private summaries/Q&A and
  // stream-resume pointers don't linger on disk.
  if (partial.url && !(await shouldPersist(partial.url))) return null;
  const key = viewStateKey(tabId);
  const { viewStateOrder = [], ...rest } = await chrome.storage.local.get([
    key,
    "viewStateOrder",
  ]);
  const state = { ...(rest[key] || {}), ...partial };

  const order = viewStateOrder.filter((k) => k !== key);
  order.push(key);
  const removeKeys = [];
  while (order.length > MAX_VIEW_STATES) {
    removeKeys.push(order.shift());
  }

  await chrome.storage.local.set({ [key]: state, viewStateOrder: order });
  if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  return state;
}

async function loadViewState(tabId) {
  if (tabId == null) return null;
  const key = viewStateKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

async function saveSettings(partial) {
  const settings = { ...(await getSettings()), ...partial };
  await chrome.storage.local.set({ settings });
  return settings;
}

// Cap how many pages we keep cached so storage doesn't grow without bound.
// `cacheOrder` is an insertion-ordered list of { s, p } key pairs used as a
// simple FIFO eviction index.
const MAX_CACHED_PAGES = 50;

async function persistSummary(cacheKey, promptsCacheKey, text) {
  const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
  const order = cacheOrder.filter((e) => e && e.s !== cacheKey);
  order.push({ s: cacheKey, p: promptsCacheKey });

  const removeKeys = [];
  while (order.length > MAX_CACHED_PAGES) {
    const old = order.shift();
    if (old?.s) removeKeys.push(old.s);
    if (old?.p) removeKeys.push(old.p);
  }

  await chrome.storage.local.set({ [cacheKey]: text, cacheOrder: order });
  if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
}

// Extracted content is cached separately (keyed only by URL, see
// getContentCacheKey) so it outlives format/model switches and popup
// close/reopen — re-asking a question or regenerating in a new format
// shouldn't require re-scraping the page.
async function persistContent(url, pageData) {
  const contentKey = getContentCacheKey(url);
  const { contentCacheOrder = [] } =
    await chrome.storage.local.get("contentCacheOrder");
  const order = contentCacheOrder.filter((k) => k !== contentKey);
  order.push(contentKey);

  const removeKeys = [];
  while (order.length > MAX_CACHED_PAGES) {
    removeKeys.push(order.shift());
  }

  await chrome.storage.local.set({
    [contentKey]: pageData,
    contentCacheOrder: order,
  });
  if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
}

async function getCachedContent(url) {
  const contentKey = getContentCacheKey(url);
  const stored = await chrome.storage.local.get(contentKey);
  return stored[contentKey] || null;
}

function getModelForSettings(settings) {
  const isFirefox = process.env.TARGET_BROWSER === "firefox";
  const provider = isFirefox ? "local" : settings.provider;
  return provider === PROVIDERS.LOCAL ? settings.localModel : settings.webllmModel;
}

// NOTE: The popup runs in a chrome-extension:// context where navigator.gpu is always undefined. The actual WebGPU context lives in the offscreen document.
// We probe the offscreen doc via the service worker instead.

let _webgpuSupported = null; // cached result

async function checkWebGPUSupport() {
  if (_webgpuSupported !== null) return _webgpuSupported;
  try {
    // Ask the service worker to create the offscreen doc and check WebGPU
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { target: "service-worker", action: "check-webgpu" },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(resp);
          }
        },
      );
    });
    _webgpuSupported = response?.supported === true;
    return _webgpuSupported;
  } catch {
    // If we can't reach the service worker, optimistically assume support so
    // the user isn't blocked, and let the offscreen doc surface the real error
    // at inference time. Do NOT cache this — a transient messaging failure
    // should not suppress the warning for the rest of the session.
    return true;
  }
}

function buildWebllmModelUI(selectedId) {
  webllmModelList.innerHTML = "";
  for (const model of WEBLLM_MODELS) {
    const label = document.createElement("label");
    label.className = "radio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "webllmModel";
    input.value = model.id;
    if (model.id === selectedId) input.checked = true;
    const span = document.createElement("span");
    span.innerHTML = `${model.label} <small class="model-size">${model.size}</small>`;
    label.appendChild(input);
    label.appendChild(span);
    webllmModelList.appendChild(label);
  }

  webllmModelList.querySelectorAll('input[name="webllmModel"]').forEach((r) => {
    r.addEventListener("change", async () => {
      // No cache wipe needed — summary/prompt cache keys are namespaced by
      // model, so switching models just starts reading/writing a different
      // slot instead of losing everything.
      await saveSettings({ webllmModel: r.value });
    });
  });
}

function applyTheme(themeName) {
  document.documentElement.classList.remove("theme-light", "theme-dark");
  let activeTheme = themeName;
  if (themeName === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    activeTheme = prefersDark ? "dark" : "light";
  }
  document.documentElement.classList.add(`theme-${activeTheme}`);
}

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", async () => {
    const settings = await getSettings();
    if (settings.theme === "system") {
      applyTheme("system");
    }
  });

async function applySettingsToUI(settings) {
  const themeRadio = document.querySelector(
    `input[name="theme"][value="${settings.theme}"]`,
  );
  if (themeRadio) themeRadio.checked = true;
  applyTheme(settings.theme);
  const isFirefox = process.env.TARGET_BROWSER === "firefox";
  const provider = isFirefox ? "local" : settings.provider;

  const provRadio = document.querySelector(
    `input[name="provider"][value="${provider}"]`,
  );
  if (provRadio) provRadio.checked = true;

  const isWebllm = provider === PROVIDERS.WEBLLM;
  webllmModelsCard.classList.toggle("hidden", !isWebllm);
  localSettingsCard.classList.toggle("hidden", isWebllm);
  localModelsCard.classList.toggle("hidden", isWebllm);

  buildWebllmModelUI(settings.webllmModel);

  if (backendUrlInput) backendUrlInput.value = settings.localApiBase;
  const localRadio = document.querySelector(
    `input[name="localModel"][value="${settings.localModel}"]`,
  );
  if (localRadio) localRadio.checked = true;

  const fmtRadio = document.querySelector(
    `input[name="format"][value="${settings.responseFormat}"]`,
  );
  if (fmtRadio) fmtRadio.checked = true;

  const historyRadio = document.querySelector(
    `input[name="saveHistory"][value="${settings.saveHistory === false ? "off" : "on"}"]`,
  );
  if (historyRadio) historyRadio.checked = true;

  if (isWebllm) {
    const supported = await checkWebGPUSupport();
    if (!supported) {
      webgpuWarning?.classList.remove("hidden");
    } else {
      webgpuWarning?.classList.add("hidden");
    }
  } else {
    webgpuWarning?.classList.add("hidden");
  }
}

async function extractFromActiveTab(tab) {
  const tabId = tab.id;

  // Inject the extractors once per page, re-injecting when the injected copy
  // is from an older extension version — otherwise a tab left open across an
  // update keeps running the stale extractor until manually refreshed.
  const expectedVersion = chrome.runtime.getManifest().version;
  let injectedVersion = null;
  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        typeof window.extractPageContent === "function"
          ? window.__apogeeExtractorVersion || "unknown"
          : null,
    });
    injectedVersion = checkResult?.[0]?.result;
  } catch {}

  if (injectedVersion !== expectedVersion) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "/content/Readability.js",
        "/content/extractors/generic.js",
        "/content/extractors/youtube.js",
        "/content/extractors/gmail.js",
        "/content/content.js",
      ],
    });
    // Stamp the version so the check above can detect staleness next time.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (v) => {
        window.__apogeeExtractorVersion = v;
      },
      args: [expectedVersion],
    });
  }

  // Return the extractor's result directly. executeScript structured-clones
  // the return value, so there's no need to round-trip it through a DOM
  // attribute + JSON.parse (which also mutated the host page).
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        // extractPageContent() is async (YouTube's extractor fetches the
        // transcript) — await it here so a rejection is caught below
        // instead of leaking an unhandled promise rejection past executeScript.
        return await window.extractPageContent();
      } catch (e) {
        return { error: e?.message || String(e) };
      }
    },
  });

  const pageData = results?.[0]?.result;
  if (pageData?.error) throw new Error(pageData.error);
  return pageData || null;
}

// Only the generic Readability-parsed extraction is expensive enough to be
// worth caching/reusing. Gmail and YouTube extractors are cheap DOM reads,
// and — unlike a fresh page load — those sites navigate between threads/
// videos via the History API, so a cached/reused result can go stale
// without `tab.url` necessarily changing in a way we'd catch. Always
// re-extract live for those instead of trusting any cache.
const CACHEABLE_PAGE_TYPES = new Set(["article", "generic"]);

async function getPageData(tab) {
  if (
    currentPageData &&
    currentPageData.url === tab.url &&
    CACHEABLE_PAGE_TYPES.has(currentPageData.type)
  ) {
    return currentPageData;
  }

  const cached = await getCachedContent(tab.url);
  if (cached && CACHEABLE_PAGE_TYPES.has(cached.type)) {
    currentPageData = cached;
    return cached;
  }

  const pageData = await extractFromActiveTab(tab);
  if (pageData) {
    currentPageData = pageData;
    if (CACHEABLE_PAGE_TYPES.has(pageData.type) && (await shouldPersist(tab.url))) {
      await persistContent(tab.url, pageData);
    }
  }
  return pageData;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "model-progress" && message.progress) {
    const p = message.progress;
    modelProgress?.classList.remove("hidden");
    modelProgressText.textContent = p.text || "Loading model...";
    if (typeof p.progress === "number") {
      const pct = Math.round(p.progress * 100);
      modelProgressPercent.textContent = `${pct}%`;
      modelProgressFill.style.width = `${pct}%`;
      if (pct >= 100) {
        setTimeout(() => modelProgress?.classList.add("hidden"), 1500);
      }
    }
  }

  if (message.type === "live-offscreen-log" && message.log) {
    if (debugLogsContent && debugLogsCard && !debugLogsCard.classList.contains("hidden")) {
      const isScrollAtBottom = debugLogsCard.scrollHeight - debugLogsCard.clientHeight <= debugLogsCard.scrollTop + 10;
      if (debugLogsContent.textContent === "No logs recorded. Try starting summary or chat.") {
        debugLogsContent.textContent = "";
      }
      debugLogsContent.textContent += (debugLogsContent.textContent ? "\n" : "") + message.log;
      if (isScrollAtBottom) {
        debugLogsCard.scrollTop = debugLogsCard.scrollHeight;
      }
    }
  }
});

function setLoadingIndicator(element, label) {
  const wrapper = document.createElement("span");
  wrapper.className = "apogee-loading";
  const spinner = document.createElement("span");
  spinner.className = "apogee-spinner";
  const text = document.createElement("span");
  text.textContent = label;
  const dots = document.createElement("span");
  dots.className = "apogee-dots";
  text.appendChild(dots);
  wrapper.appendChild(spinner);
  wrapper.appendChild(text);
  element.textContent = "";
  element.appendChild(wrapper);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(escapedText) {
  return escapedText
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>");
}

function renderMarkdown(source) {
  const lines = escapeHtml(source).split(/\r?\n/);
  let html = "";
  let listType = null;
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      html += `<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`;
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${renderInline(bullet[1])}</li>`;
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${renderInline(ordered[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${renderInline(line)}</p>`;
  }
  closeList();
  return html;
}

function resetQuestionCards() {
  setSuggestedQuestions([]);
}

function setSuggestedQuestions(questions) {
  questionHeading.textContent = "Suggested Prompts";
  promptsCloseBtn.classList.remove("hidden");
  const container = document.getElementById("questionContainer");
  container.innerHTML = "";
  questions.slice(0, 2).forEach((text) => {
    const btn = document.createElement("button");
    btn.className = "prompt-card";
    btn.textContent = text;
    container.appendChild(btn);
  });
}

function setSuggestedQuestionsLoading() {
  questionHeading.textContent = "Suggested Prompts";
  const container = document.getElementById("questionContainer");
  container.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "prompt-card";
  btn.disabled = true;
  btn.textContent = "Generating suggested prompts...";
  container.appendChild(btn);
}

// Hash the URL (cyrb53) so raw URLs — which can carry session tokens or reset
// links in their query strings — aren't left sitting in plaintext storage
// keys. Non-cryptographic, but wide enough to avoid collisions in the small
// bounded cache.
function hashUrl(url) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function getSummaryCacheKey(url, fmt, model) {
  return `summary:${fmt}:${model}:${hashUrl(url)}`;
}
function getPromptsCacheKey(url, fmt, model) {
  return `suggested-prompts:${fmt}:${model}:${hashUrl(url)}`;
}
// Extracted page content is independent of format/model, so it's cached
// separately and survives model switches and popup close/reopen — avoids
// re-scraping (a full Readability parse on generic pages) just to ask a
// follow-up question or regenerate a summary in a different format.
function getContentCacheKey(url) {
  return `content:${hashUrl(url)}`;
}

// Hosts whose pages routinely contain private content (email, etc.). Their
// summaries and Q&A are never persisted to disk, regardless of the
// saveHistory setting — see shouldPersist.
const SENSITIVE_HOST_PATTERNS = [
  /(^|\.)mail\.google\.com$/,
  /(^|\.)outlook\.(live|office|office365)\.com$/,
  /(^|\.)mail\.proton\.me$/,
  /(^|\.)mail\.yahoo\.com$/,
  /(^|\.)messages\.google\.com$/,
  /(^|\.)web\.whatsapp\.com$/,
];

function isSensitiveUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SENSITIVE_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

// Whether page-derived data for this URL may be written to disk.
async function shouldPersist(url) {
  if (isSensitiveUrl(url)) return false;
  const settings = await getSettings();
  return settings.saveHistory !== false;
}

function showSummarizingContext() {
  summaryCard.classList.remove("hidden");
  promptsSection.classList.add("hidden");
  chatSection.classList.add("hidden");
  resetQuestionCards();
  questionInput.value = "";
  answerBox.textContent = "";
  answerBox.classList.add("hidden");
  togglePromptsBtn.style.display = "none";
}

function showSummaryContext(questions = []) {
  summaryCard.classList.remove("hidden");
  promptsSection.classList.remove("hidden");
  questionHeading.textContent = "Suggested Prompts";
  answerHeading.textContent = "Ask Apogee";
  setSuggestedQuestions(questions);
  chatSection.classList.remove("hidden");
  promptsCloseBtn.classList.remove("hidden");
  questionInput.classList.remove("hidden");
  sendBtn.classList.remove("hidden");
  answerBox.classList.add("hidden");
  questionInput.value = "";
  answerBox.textContent = "";
  togglePromptsBtn.style.display = "none";
}

function showAskContext() {
  summaryCard.classList.add("hidden");
  promptsSection.classList.remove("hidden");
  questionHeading.textContent = "Suggested Prompts";
  answerHeading.textContent = "Ask Apogee";
  resetQuestionCards();
  chatSection.classList.remove("hidden");
  promptsCloseBtn.classList.add("hidden");
  questionInput.classList.remove("hidden");
  sendBtn.classList.remove("hidden");
  answerBox.classList.add("hidden");
  questionInput.value = "";
  answerBox.textContent = "";
  togglePromptsBtn.style.display = "none";
}

function showAnswerContext(question) {
  const container = document.getElementById("questionContainer");
  container.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "prompt-card";
  btn.disabled = true;
  btn.textContent = question;
  container.appendChild(btn);
  summaryCard.classList.add("hidden");
  promptsSection.classList.remove("hidden");
  questionHeading.textContent = "Question";
  answerHeading.textContent = "Answer";
  promptsCloseBtn.classList.add("hidden");
  togglePromptsBtn.style.display = "none";
  questionInput.classList.add("hidden");
  sendBtn.classList.add("hidden");
  answerBox.classList.remove("hidden");
  setLoadingIndicator(answerBox, "Thinking");
}

async function streamGeneratorIntoElement(generator, element) {
  let fullText = "";
  let started = false;
  for await (const chunk of generator) {
    fullText += chunk;
    const visible = fullText.trimStart();
    if (!started && visible === "") continue;
    started = true;
    element.innerHTML = renderMarkdown(visible);
  }
  element.innerHTML = renderMarkdown(fullText.trimStart());
  return fullText;
}

// Consumes a summary stream to completion (persisting the result, showing
// the summary view, and fetching suggested questions). Shared between a
// freshly started summarize job and one being resumed after the popup was
// reopened mid-stream.
async function consumeSummaryStream(stream, { tab, cacheKey, promptsCacheKey, pageData }) {
  const text = await streamGeneratorIntoElement(stream, summaryText);

  const persist = await shouldPersist(tab.url);
  if (persist) await persistSummary(cacheKey, promptsCacheKey, text);
  currentSummaryText = text;
  showSummaryContext();
  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "summary",
    url: tab.url,
    streamId: null,
  });
  setSuggestedQuestionsLoading();

  // Generate prompts in the background so they persist if the popup closes.
  const settings = await getSettings();
  startSuggestedQuestionsBg(
    promptsCacheKey,
    {
      title: pageData?.title || tab.title || "",
      url: pageData?.url || tab.url,
      summary: text,
    },
    settings,
    persist,
  );
  return text;
}

async function summarizeActivePage() {
  homeView.classList.add("hidden");
  summaryView.classList.remove("hidden");
  showSummarizingContext();
  setLoadingIndicator(summaryText, "Summarizing");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await saveViewState(tab.id, {
      view: "summaryView",
      subview: "summarizing",
      url: tab.url,
      streamId: null,
    });
    const settings = await getSettings();
    const provider = getProvider(settings);
    const model = getModelForSettings(settings);
    // Explicit "Summarize" click always re-reads the live page — unlike
    // getPageData()'s reuse path (used by follow-up questions), we don't
    // want a stale cached extraction here.
    const pageData = await extractFromActiveTab(tab);

    if (!pageData) {
      summaryText.textContent = "Could not extract page.";
      return;
    }
    // Gmail returns empty content when no thread is open rather than
    // dumping the inbox chrome — surface that instead of sending blank
    // content to the model.
    if (!pageData.isPdf && !pageData.content) {
      summaryText.textContent =
        "Could not find anything to summarize on this page.";
      return;
    }
    currentPageData = pageData;
    if (CACHEABLE_PAGE_TYPES.has(pageData.type) && (await shouldPersist(tab.url))) {
      await persistContent(tab.url, pageData);
    }

    const cacheKey = getSummaryCacheKey(tab.url, settings.responseFormat, model);
    const promptsCacheKey = getPromptsCacheKey(
      tab.url,
      settings.responseFormat,
      model,
    );

    let streamId, stream;

    if (pageData.isPdf) {
      setLoadingIndicator(summaryText, "Summarizing PDF");
      if (settings.provider === PROVIDERS.LOCAL) {
        ({ streamId, stream } = await provider.summarizePdf({
          url: pageData.url,
          mode: settings.responseFormat,
        }));
      } else {
        if (!pageData.content) {
          const p = document.createElement("p");
          p.style.color = "#d93025";
          p.style.fontSize = "13px";
          p.textContent = "PDF summarization requires Local Ollama mode. Switch to Local Ollama in Settings to summarize PDFs.";
          summaryText.textContent = "";
          summaryText.appendChild(p);
          return;
        }
        ({ streamId, stream } = await provider.summarize({
          title: pageData.title,
          url: pageData.url,
          content: pageData.content,
          mode: settings.responseFormat,
        }));
      }
    } else {
      ({ streamId, stream } = await provider.summarize({
        title: pageData.title,
        url: pageData.url,
        content: pageData.content,
        mode: settings.responseFormat,
      }));
    }

    await saveViewState(tab.id, {
      view: "summaryView",
      subview: "summarizing",
      url: tab.url,
      streamId,
      cacheKey,
      promptsCacheKey,
    });

    await consumeSummaryStream(stream, { tab, cacheKey, promptsCacheKey, pageData });
  } catch (error) {
    console.error(error);
    const p = document.createElement("p");
    p.style.color = "#d93025";
    p.style.fontSize = "13px";
    p.textContent = error.message;
    summaryText.textContent = "";
    summaryText.appendChild(p);
  }
}

// Consumes an "ask" stream to completion, rendering into answerBox and
// persisting the final answer text so a reopened popup can show it without
// needing to re-run the question. Shared between a freshly started ask and
// one being resumed after the popup was closed mid-stream.
async function consumeAnswerStream(stream, { tab, question }) {
  let fullText = "";
  let started = false;
  for await (const chunk of stream) {
    fullText += chunk;
    if (!started && fullText.trim() === "") continue;
    if (!started) {
      answerBox.textContent = "";
      started = true;
    }
    answerBox.textContent = fullText.trimStart();
  }
  if (started) answerBox.innerHTML = renderMarkdown(answerBox.textContent);
  else answerBox.textContent = "";

  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "answer",
    url: tab.url,
    streamId: null,
    question,
    answerText: fullText,
  });
  return fullText;
}

async function submitQuestion(question) {
  const trimmed = question.trim();
  if (!trimmed) {
    questionInput.focus();
    return;
  }
  showAnswerContext(trimmed);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await saveViewState(tab.id, {
      view: "summaryView",
      subview: "answer",
      url: tab.url,
      streamId: null,
      question: trimmed,
      answerText: "",
    });
    // Reuse cached page data (in-memory or persisted) when it's safe to —
    // see getPageData()/CACHEABLE_PAGE_TYPES for why Gmail/YouTube are
    // always re-extracted live instead.
    let pageData = await getPageData(tab);
    if (!pageData) {
      answerBox.textContent = "Could not extract page.";
      return;
    }
    currentPageData = pageData;

    const settings = await getSettings();
    const provider = getProvider(settings);
    const content = pageData.content || currentSummaryText;
    if (!content) {
      throw new Error("Could not extract enough page content to answer.");
    }

    const { streamId, stream } = await provider.ask({
      title: pageData.title,
      url: pageData.url,
      content,
      question: trimmed,
    });

    await saveViewState(tab.id, {
      view: "summaryView",
      subview: "answer",
      url: tab.url,
      streamId,
      question: trimmed,
    });

    await consumeAnswerStream(stream, { tab, question: trimmed });
  } catch (error) {
    console.error(error);
    answerBox.textContent = error.message;
  }
}

async function checkConnection() {
  const settings = await getSettings();
  const provider = getProvider(settings);
  const status = await provider.checkReady();
  return status?.ready === true;
}

function updateConnectionUI(connected) {
  const text = connected ? "Connected" : "Disconnected";
  const cls = connected ? "status-dot connected" : "status-dot disconnected";
  for (const id of [
    "homeStatusText",
    "settingsStatusText",
    "summaryStatusText",
  ]) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  for (const id of ["homeStatusDot", "settingsStatusDot", "summaryStatusDot"]) {
    const el = document.getElementById(id);
    if (el) el.className = cls;
  }
}

function showOnlyView(view) {
  homeView.classList.toggle("hidden", view !== "homeView");
  summaryView.classList.toggle("hidden", view !== "summaryView");
  settingsView.classList.toggle("hidden", view !== "settingsView");
  contactView.classList.toggle("hidden", view !== "contactView");
}

document.addEventListener("DOMContentLoaded", async () => {
  const isFirefox = process.env.TARGET_BROWSER === "firefox";
  if (isFirefox && providerSettingsCard) {
    providerSettingsCard.classList.add("hidden");
  }
  try {
    const settings = await getSettings();
    await applySettingsToUI(settings);

    const connected = await checkConnection();
    updateConnectionUI(connected);

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    activeTabId = tab.id;

    const state = await loadViewState(tab.id);

    // Mid-summarize or mid-answer when the popup last closed: the job kept
    // running in the background, so reattach instead of restarting it.
    if (state && state.url === tab.url && state.streamId) {
      if (state.subview === "summarizing") {
        showOnlyView("summaryView");
        showSummarizingContext();
        setLoadingIndicator(summaryText, "Summarizing");
        try {
          const pageData = await getPageData(tab);
          await consumeSummaryStream(attachToStream(state.streamId), {
            tab,
            cacheKey: state.cacheKey,
            promptsCacheKey: state.promptsCacheKey,
            pageData,
          });
        } catch (error) {
          console.error(error);
          const p = document.createElement("p");
          p.style.color = "#d93025";
          p.style.fontSize = "13px";
          p.textContent = error.message;
          summaryText.textContent = "";
          summaryText.appendChild(p);
        }
        return;
      }

      if (state.subview === "answer") {
        showOnlyView("summaryView");
        showAnswerContext(state.question || "");
        try {
          await consumeAnswerStream(attachToStream(state.streamId), {
            tab,
            question: state.question || "",
          });
        } catch (error) {
          console.error(error);
          answerBox.textContent = error.message;
        }
        return;
      }
    }

    // No in-flight job — restore whichever static page the user was last on.
    if (state && state.url === tab.url) {
      if (state.view === "settingsView") {
        showOnlyView("settingsView");
        return;
      }
      if (state.view === "contactView") {
        showOnlyView("contactView");
        return;
      }
      if (state.view === "summaryView") {
        if (state.subview === "answer" && state.question) {
          showOnlyView("summaryView");
          showAnswerContext(state.question);
          answerBox.innerHTML = renderMarkdown(state.answerText || "");
          return;
        }
        if (state.subview === "ask") {
          showOnlyView("summaryView");
          showAskContext();
          questionInput.focus();
          return;
        }
        // subview === "summary" (or unknown) falls through to the cache
        // lookup below, which is the source of truth for summary text.
      }
    }

    const model = getModelForSettings(settings);
    const cacheKey = getSummaryCacheKey(tab.url, settings.responseFormat, model);
    const promptsCacheKey = getPromptsCacheKey(
      tab.url,
      settings.responseFormat,
      model,
    );
    const cached = await chrome.storage.local.get([cacheKey, promptsCacheKey]);

    if (cached[cacheKey]) {
      currentSummaryText = cached[cacheKey];
      summaryText.innerHTML = renderMarkdown(cached[cacheKey]);
      showOnlyView("summaryView");
      // A present key (even []) means prompts finished; a missing key means
      // they were still generating when the popup closed — show loading and
      // re-kick the job so the storage listener can fill them in.
      if (cached[promptsCacheKey] !== undefined) {
        showSummaryContext(cached[promptsCacheKey]);
      } else {
        showSummaryContext([]);
        setSuggestedQuestionsLoading();
        startSuggestedQuestionsBg(
          promptsCacheKey,
          { title: tab.title || "", url: tab.url, summary: cached[cacheKey] },
          settings,
          await shouldPersist(tab.url),
        );
      }
      return;
    }
  } catch (error) {
    console.error(error);
  }
  showOnlyView("homeView");
});

summarizeBtn?.addEventListener("click", () => summarizeActivePage());

settingsBtn?.addEventListener("click", () => {
  showOnlyView("settingsView");
  saveViewState(activeTabId, { view: "settingsView" });
});

settingsBtn2?.addEventListener("click", () => {
  showOnlyView("settingsView");
  saveViewState(activeTabId, { view: "settingsView" });
});

closeBtn?.addEventListener("click", () => window.close());
closeBtn2?.addEventListener("click", () => window.close());
closeBtn3?.addEventListener("click", () => window.close());
closeBtn4?.addEventListener("click", () => window.close());

document.getElementById("askBtn")?.addEventListener("click", async () => {
  showOnlyView("summaryView");
  showAskContext();
  questionInput.focus();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "ask",
    url: tab.url,
    streamId: null,
  });
});

sendBtn?.addEventListener("click", () => submitQuestion(questionInput.value));
questionInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitQuestion(questionInput.value);
  }
});

// Provider/format/model/backend changes no longer wipe the cache: provider
// switches already land on a distinct model id (webllmModel vs localModel
// namespaces don't collide), and format/model are baked into the cache key
// itself — see getSummaryCacheKey.
providerRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const settings = await saveSettings({ provider: radio.value });
    await applySettingsToUI(settings);
    updateConnectionUI(await checkConnection());
  });
});

formatRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ responseFormat: radio.value });
  });
});

themeRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const settings = await saveSettings({ theme: radio.value });
    applyTheme(settings.theme);
  });
});

localModelRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ localModel: radio.value });
  });
});

saveHistoryRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ saveHistory: radio.value === "on" });
  });
});

// Removes every persisted summary, suggested-prompt set, extracted page body,
// and per-tab view state (plus their FIFO indexes) — the "clear cached data"
// control. Preferences (the `settings` key) are intentionally left intact.
async function clearCachedData() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    (k) =>
      k.startsWith("summary:") ||
      k.startsWith("suggested-prompts:") ||
      k.startsWith("content:") ||
      k.startsWith("popupViewState:") ||
      k === "cacheOrder" ||
      k === "contentCacheOrder" ||
      k === "viewStateOrder",
  );
  if (keys.length > 0) await chrome.storage.local.remove(keys);
  return keys.length;
}

clearDataBtn?.addEventListener("click", async () => {
  clearDataBtn.disabled = true;
  try {
    await clearCachedData();
    currentSummaryText = "";
    if (clearDataStatus) clearDataStatus.textContent = "Cached data cleared.";
  } catch (err) {
    if (clearDataStatus) clearDataStatus.textContent = `Error: ${err.message}`;
  } finally {
    clearDataBtn.disabled = false;
  }
});

backendUrlInput?.addEventListener("change", async () => {
  const val = (backendUrlInput.value || DEFAULT_LOCAL_API_BASE)
    .trim()
    .replace(/\/+$/, "");
  const settings = await saveSettings({ localApiBase: val });
  await applySettingsToUI(settings);
  updateConnectionUI(await checkConnection());
});

promptsCloseBtn?.addEventListener("click", () => {
  promptsSection.classList.add("hidden");
  togglePromptsBtn.style.display = "flex";
});

togglePromptsBtn?.addEventListener("click", () => {
  promptsSection.classList.remove("hidden");
  togglePromptsBtn.style.display = "none";
});

getInTouchBtn?.addEventListener("click", () => {
  showOnlyView("contactView");
  saveViewState(activeTabId, { view: "contactView" });
});

document.getElementById("contributeBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/darshi1337/apogee" });
});
document.getElementById("bugBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/darshi1337/apogee/issues" });
});
document.getElementById("featureBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/darshi1337/apogee/issues" });
});

settingsBackBtn?.addEventListener("click", () => {
  showOnlyView("homeView");
  saveViewState(activeTabId, { view: "homeView" });
});

contactBackBtn?.addEventListener("click", () => {
  showOnlyView("settingsView");
  saveViewState(activeTabId, { view: "settingsView" });
});

document
  .getElementById("questionContainer")
  ?.addEventListener("click", (event) => {
    const card = event.target.closest(".prompt-card");
    if (!card || card.disabled) return;
    submitQuestion(card.textContent);
  });

// Signal popup lifecycle to the service worker to handle offscreen document cleanup
chrome.runtime.connect({ name: "popup-lifecycle" });

async function updateDebugLogsUI() {
  if (!debugLogsCard || debugLogsCard.classList.contains("hidden")) return;
  try {
    const res = await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "get-offscreen-logs"
    });
    if (res && Array.isArray(res.logs)) {
      debugLogsContent.textContent = res.logs.join("\n") || "No logs recorded. Try starting summary or chat.";
      debugLogsCard.scrollTop = debugLogsCard.scrollHeight;
    }
  } catch (err) {
    debugLogsContent.textContent = `Error fetching logs: ${err.message}`;
  }
}

toggleDebugLogsBtn?.addEventListener("click", async () => {
  // Update only the label span so the leading icon isn't clobbered; fall back
  // to the element itself if the markup ever changes.
  const label =
    toggleDebugLogsBtn.querySelector(".logs-toggle-label") || toggleDebugLogsBtn;
  const isHidden = debugLogsCard.classList.contains("hidden");
  if (isHidden) {
    debugLogsCard.classList.remove("hidden");
    label.textContent = "Hide logs";
    await updateDebugLogsUI();
  } else {
    debugLogsCard.classList.add("hidden");
    label.textContent = "Show logs";
  }
});

clearDebugLogsBtn?.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "clear-offscreen-logs"
    });
    debugLogsContent.textContent = "No logs recorded. Try starting summary or chat.";
  } catch (err) {
    debugLogsContent.textContent = `Error clearing logs: ${err.message}`;
  }
});
