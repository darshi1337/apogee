// Only load the dev-only chrome.* shim when running outside a real
// extension context (e.g. a built dist/*/popup/popup.html opened directly
// in a browser tab, not loaded unpacked, for UI iteration). In the shipped
// extension chrome.runtime.sendMessage is always defined, so this branch,
// and the dynamic import for mock.js it would trigger, never runs for real
// users. (Gating this further on a Vite `import.meta.env.DEV`-style build
// flag was tried and reverted: this project's own "dev" script is still a
// full `vite build` under the hood, so that flag is always false in every
// build this project produces, including the one real UI-iteration
// workflow above; an `import.meta.env.DEV` gate would have permanently
// disabled the shim rather than just trimming it from the packaged zip/xpi.)
if (
  typeof chrome === "undefined" ||
  !chrome.runtime ||
  !chrome.runtime.sendMessage
) {
  await import("./mock.js");
}

import {
  getProvider,
  getProviderType,
  getModelForSettings,
  attachToStream,
  cancelStream,
  StreamCancelledError,
} from "../lib/engines/providers.js";
import {
  PROVIDERS,
  WEBLLM_MODELS,
  TRANSFORMERS_MODELS,
  LOCAL_MODELS,
  DEFAULT_OLLAMA_HOST,
  SUMMARY_LANGUAGES,
  CUSTOM_INSTRUCTIONS_MAX_CHARS,
  isVideoType,
} from "../lib/constants.js";
import { getSettings } from "../lib/storage/settings.js";
import { formatSummaryAsMarkdown } from "../lib/util/exportFormat.js";
import {
  formatTimeSaved,
  formatVideoTimeSaved,
  timeSavedInputsFor,
  formatTimeSavedFromInputs,
} from "../lib/util/readingTime.js";
import { saveViewState, loadViewState } from "../lib/storage/viewState.js";
import {
  hashUrl,
  getSummaryCacheKey,
  getPromptsCacheKey,
  persistContent,
  getCachedContent,
  shouldPersist,
  CACHEABLE_PAGE_TYPES,
} from "../lib/storage/pageCache.js";
import {
  extractFromActiveTab,
  extractPdfContent,
} from "../lib/extract/pageExtraction.js";
// Icons render from icons.js's own <script> in popup.html; this import is only
// for the buttons whose contents are rebuilt here.
import { icon, ICONS } from "./icons.js";

const summarizeBtn = document.getElementById("summarizeBtn");
const summarizeShortcutHint = document.getElementById("summarizeShortcutHint");
const summaryText = document.getElementById("summaryText");
const cancelSummarizeBtn = document.getElementById("cancelSummarizeBtn");
const resummarizeBtn = document.getElementById("resummarizeBtn");
const resummarizeHint = document.getElementById("resummarizeHint");
const resummarizeHintText = document.getElementById("resummarizeHintText");
const resummarizeHintBtn = document.getElementById("resummarizeHintBtn");
const timeSavedBadge = document.getElementById("timeSavedBadge");
const copySummaryBtn = document.getElementById("copySummaryBtn");
const copyMarkdownBtn = document.getElementById("copyMarkdownBtn");
const copyAnswerBtn = document.getElementById("copyAnswerBtn");
const cancelAskBtn = document.getElementById("cancelAskBtn");
const pastSummariesSection = document.getElementById("pastSummariesSection");
const pastSummariesList = document.getElementById("pastSummariesList");
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
const customInstructionsInput = document.getElementById(
  "customInstructionsInput",
);
const customInstructionsCount = document.getElementById(
  "customInstructionsCount",
);
const summaryLanguageSelect = document.getElementById("summaryLanguageSelect");
const translationEngineRadios = document.querySelectorAll(
  'input[name="translationEngine"]',
);
const providerRadios = document.querySelectorAll('input[name="provider"]');
const themeRadios = document.querySelectorAll('input[name="theme"]');
const backendUrlInput = document.getElementById("backendUrlInput");
const promptsCloseBtn = document.querySelector(".prompts-toggle");
const togglePromptsBtn = document.getElementById("togglePromptsBtn");
const getInTouchBtn = document.getElementById("getInTouchBtn");
const contactView = document.getElementById("contactView");
const settingsBackBtn = document.getElementById("settingsBackBtn");
const contactBackBtn = document.getElementById("contactBackBtn");
const webllmProviderOption = document.getElementById("webllmProviderOption");
const webllmModelsCard = document.getElementById("webllmModelsCard");
const transformersModelsCard = document.getElementById(
  "transformersModelsCard",
);
const localSettingsCard = document.getElementById("localSettingsCard");
const localModelsCard = document.getElementById("localModelsCard");
const webllmModelList = document.getElementById("webllmModelList");
const transformersModelList = document.getElementById("transformersModelList");
const localModelList = document.getElementById("localModelList");
const localModelStatus = document.getElementById("localModelStatus");
const webgpuWarning = document.getElementById("webgpuWarning");
const modelProgress = document.getElementById("modelProgress");
const modelProgressText = document.getElementById("modelProgressText");
const modelProgressPercent = document.getElementById("modelProgressPercent");
const modelProgressFill = document.getElementById("modelProgressFill");
const toggleDebugLogsBtn = document.getElementById("toggleDebugLogsBtn");
const debugLogsCard = document.getElementById("debugLogsCard");
const debugLogsContent = document.getElementById("debugLogsContent");
const clearDebugLogsBtn = document.getElementById("clearDebugLogsBtn");
const a11yAnnouncer = document.getElementById("a11yAnnouncer");
const saveHistoryRadios = document.querySelectorAll(
  'input[name="saveHistory"]',
);
const sponsorBlockRadios = document.querySelectorAll(
  'input[name="useSponsorBlock"]',
);
const debugLogsRadios = document.querySelectorAll('input[name="debugLogs"]');
const clearDataBtn = document.getElementById("clearDataBtn");
const clearDataStatus = document.getElementById("clearDataStatus");
const versionText = document.getElementById("versionText");

// Read from the manifest instead of hardcoding a version string here, which
// drifted out of sync with the real package/manifest version in the past.
if (versionText) {
  versionText.textContent = `v${chrome.runtime.getManifest().version}`;
}

let currentPageData = null;
let currentSummaryText = "";
// The summaryLanguage the on-screen summary was actually generated in, so we
// can flag it as stale when the user later switches the language setting
// without re-summarizing (see updateResummarizeHint). null when no summary is
// displayed.
let currentSummaryLanguage = null;

// code -> display label, for the "Re-summarize to apply <language>" hint.
const LANGUAGE_LABELS = new Map(
  SUMMARY_LANGUAGES.map((l) => [l.code, l.label]),
);

// Shows a "this summary isn't in the selected language" nudge when the
// displayed summary's language no longer matches the summaryLanguage setting.
// Changing the setting (like changing Response Format) deliberately does NOT
// auto-regenerate; this just makes the staleness visible and one click to fix.
async function updateResummarizeHint(settings) {
  if (!resummarizeHint) return;
  const s = settings || (await getSettings());
  const target = s.summaryLanguage;
  const stale =
    !!currentSummaryText.trim() &&
    currentSummaryLanguage != null &&
    currentSummaryLanguage !== target;
  if (!stale) {
    resummarizeHint.classList.add("hidden");
    return;
  }
  resummarizeHintText.textContent =
    target === "auto"
      ? "This summary isn't in the page's original language. Re-summarize to apply."
      : `This summary isn't in ${LANGUAGE_LABELS.get(target) || target}. Re-summarize to apply.`;
  resummarizeHint.classList.remove("hidden");
}

resummarizeHintBtn?.addEventListener("click", () => {
  resummarizeHint?.classList.add("hidden");
  summarizeActivePage();
});
let currentAnswerText = "";
// streamId of the summarize job currently in flight, if any; drives the
// Cancel button, cleared on any terminal outcome (done/cancelled/error).
let activeSummarizeStreamId = null;
// Same idea as activeSummarizeStreamId, for the "Ask a question" flow.
let activeAskStreamId = null;
// Which view Settings was opened from (homeView or summaryView), so its
// back button returns there instead of always landing on Home, that used
// to drop a just-generated summary still sitting in summaryView's DOM.
let settingsEntryView = "homeView";

// The tab the popup is currently associated with. Set once on
// DOMContentLoaded and reused by view-state persistence below, the popup
// doesn't follow tab switches while it's open.
let activeTabId = null;

// The prompts-cache key the storage listener below is currently watching for.
// See runSuggestQuestionsJob in service-worker.js.
let currentPromptsCacheKey = null;

// Kicks off suggested-question generation as a background job. When `persist`
// is true the result is cached (and delivered via storage.onChanged, so a
// reopened popup still gets it); when false it's kept ephemeral and delivered
// only via the runtime message below to a still-open popup.
function startSuggestedQuestionsBg(
  promptsCacheKey,
  { title, url, summary },
  settings,
  persist = true,
) {
  currentPromptsCacheKey = promptsCacheKey;
  chrome.runtime
    .sendMessage({
      target: "service-worker",
      action: "suggest-questions-bg",
      payload: {
        promptsCacheKey,
        persist,
        // Normalized the same way getProvider() resolves a real provider
        // instance (see getProviderType), not the raw settings.provider: a
        // stale value carried over from the other build's profile (e.g.
        // "webllm" in a Firefox profile) used to fall through to the
        // `else` branch in runSuggestQuestionsJob, which tries to talk to
        // an offscreen document Firefox doesn't have.
        providerType: getProviderType(settings),
        host: settings.ollamaHost,
        title,
        url,
        summary,
        model: getModelForSettings(settings),
        language: settings.summaryLanguage,
        translationEngine: settings.translationEngine,
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

// Direct delivery from the background job, the only path when prompts aren't
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

async function saveSettings(partial) {
  const settings = { ...(await getSettings()), ...partial };
  await chrome.storage.local.set({ settings });
  return settings;
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
    // at inference time. Do NOT cache this, a transient messaging failure
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
      // No cache wipe needed, summary/prompt cache keys are namespaced by
      // model, so switching models just starts reading/writing a different
      // slot instead of losing everything.
      await saveSettings({ webllmModel: r.value });
    });
  });
}

// Mirrors buildWebllmModelUI, driven by TRANSFORMERS_MODELS instead.
function buildTransformersModelUI(selectedId) {
  transformersModelList.innerHTML = "";
  for (const model of TRANSFORMERS_MODELS) {
    const label = document.createElement("label");
    label.className = "radio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "transformersModel";
    input.value = model.id;
    if (model.id === selectedId) input.checked = true;
    const span = document.createElement("span");
    span.innerHTML = `${model.label} <small class="model-size">${model.size}</small>`;
    label.appendChild(input);
    label.appendChild(span);
    transformersModelList.appendChild(label);
  }

  transformersModelList
    .querySelectorAll('input[name="transformersModel"]')
    .forEach((r) => {
      r.addEventListener("change", async () => {
        await saveSettings({ transformersModel: r.value });
      });
    });
}

// Mirrors buildWebllmModelUI. `models` defaults to the hardcoded
// LOCAL_MODELS list, but updateLocalModelList (below) overrides it with
// whatever Ollama actually reports having pulled, once that's known.
function buildLocalModelUI(selectedId, models = LOCAL_MODELS) {
  localModelList.innerHTML = "";
  for (const model of models) {
    const label = document.createElement("label");
    label.className = "radio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "localModel";
    input.value = model.id;
    if (model.id === selectedId) input.checked = true;
    const span = document.createElement("span");
    span.textContent = model.label;
    label.appendChild(input);
    label.appendChild(span);
    localModelList.appendChild(label);
  }

  localModelList.querySelectorAll('input[name="localModel"]').forEach((r) => {
    r.addEventListener("change", async () => {
      await saveSettings({ localModel: r.value });
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
  const provider = settings.provider;

  const provRadio = document.querySelector(
    `input[name="provider"][value="${provider}"]`,
  );
  if (provRadio) provRadio.checked = true;

  const isWebllm = provider === PROVIDERS.WEBLLM;
  const isTransformers = provider === PROVIDERS.TRANSFORMERS;
  const isLocal = provider === PROVIDERS.LOCAL;
  webllmModelsCard.classList.toggle("hidden", !isWebllm);
  transformersModelsCard?.classList.toggle("hidden", !isTransformers);
  localSettingsCard.classList.toggle("hidden", !isLocal);
  localModelsCard.classList.toggle("hidden", !isLocal);

  buildWebllmModelUI(settings.webllmModel);
  buildTransformersModelUI(settings.transformersModel);

  if (backendUrlInput) backendUrlInput.value = settings.ollamaHost;
  buildLocalModelUI(settings.localModel);

  const fmtRadio = document.querySelector(
    `input[name="format"][value="${settings.responseFormat}"]`,
  );
  if (fmtRadio) fmtRadio.checked = true;

  if (customInstructionsInput) {
    customInstructionsInput.value = settings.customInstructions || "";
    updateCustomInstructionsCount();
  }

  if (summaryLanguageSelect) {
    // Populate once (the option set is static); re-selecting the stored value
    // on every applySettingsToUI keeps the dropdown in sync after a reset.
    if (summaryLanguageSelect.options.length === 0) {
      for (const lang of SUMMARY_LANGUAGES) {
        const opt = document.createElement("option");
        opt.value = lang.code;
        opt.textContent = lang.label;
        summaryLanguageSelect.appendChild(opt);
      }
    }
    summaryLanguageSelect.value = settings.summaryLanguage;
  }

  const translationRadio = document.querySelector(
    `input[name="translationEngine"][value="${settings.translationEngine}"]`,
  );
  if (translationRadio) translationRadio.checked = true;

  const historyRadio = document.querySelector(
    `input[name="saveHistory"][value="${settings.saveHistory === false ? "off" : "on"}"]`,
  );
  if (historyRadio) historyRadio.checked = true;

  const sponsorBlockRadio = document.querySelector(
    `input[name="useSponsorBlock"][value="${settings.useSponsorBlock === false ? "off" : "on"}"]`,
  );
  if (sponsorBlockRadio) sponsorBlockRadio.checked = true;

  const debugLogsRadio = document.querySelector(
    `input[name="debugLogs"][value="${settings.debugLogs === true ? "on" : "off"}"]`,
  );
  if (debugLogsRadio) debugLogsRadio.checked = true;

  // Fire-and-forget: checkWebGPUSupport() can create the offscreen document
  // on a cold start (a few seconds on Chrome), which used to make every
  // caller of applySettingsToUI, including the popup's initial view
  // restore on DOMContentLoaded, block on a warning banner that has
  // nothing to do with which view should be shown. The banner just appears
  // a moment later once this resolves instead.
  updateWebgpuWarning(isWebllm).catch((err) => console.error(err));
}

async function updateWebgpuWarning(isWebllm) {
  if (!isWebllm) {
    webgpuWarning?.classList.add("hidden");
    return;
  }
  const supported = await checkWebGPUSupport();
  if (!supported) {
    webgpuWarning?.classList.remove("hidden");
  } else {
    webgpuWarning?.classList.add("hidden");
  }
}

async function getPageData(tab) {
  if (
    currentPageData &&
    currentPageData.url === tab.url &&
    // PDFs aren't in CACHEABLE_PAGE_TYPES (content.js's extractor never sets
    // `type` for them, and their text isn't persisted, see below), but a
    // PDF already extracted earlier in this popup session (e.g. by a prior
    // Summarize) is still worth reusing here: re-running
    // extractFromActiveTab for a PDF only ever returns `content: null` (the
    // real text comes from the separate extractPdfContent() pipeline
    // below), so without this check, asking a follow-up question after
    // summarizing a PDF used to silently clobber the already-extracted text
    // with null.
    (CACHEABLE_PAGE_TYPES.has(currentPageData.type) ||
      (currentPageData.isPdf && currentPageData.content))
  ) {
    return currentPageData;
  }

  const cached = await getCachedContent(tab.url);
  if (cached && CACHEABLE_PAGE_TYPES.has(cached.type)) {
    currentPageData = cached;
    return cached;
  }

  const pageData = await extractFromActiveTab(tab);
  if (pageData?.isPdf) {
    // content.js's extractor can't pull PDF text itself (needs pdf.js,
    // which runs in the service worker, see extractPdfContent), so fetch it
    // here too, the same way summarizeActivePage does, otherwise asking a
    // question about a PDF without summarizing it first always fails with
    // "Could not extract enough page content to answer."
    pageData.content = await extractPdfContent(tab);
  }
  if (pageData) {
    currentPageData = pageData;
    if (
      CACHEABLE_PAGE_TYPES.has(pageData.type) &&
      (await shouldPersist(tab.url))
    ) {
      await persistContent(tab.url, pageData);
    }
  }
  return pageData;
}

// Pending "hide the progress bar 1.5s after it hit 100%" timer. Tracked (not
// fire-and-forget) so a *new* download starting right after a previous one
// finished, e.g. the Opus translator loading just after the summarization
// model, cancels the stale hide instead of having it blank out the bar
// mid-download. Every incoming progress message clears it first.
let modelProgressHideTimer = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "model-progress" && message.progress) {
    const p = message.progress;
    clearTimeout(modelProgressHideTimer);
    modelProgress?.classList.remove("hidden");
    modelProgressText.textContent = p.text || "Loading model...";
    if (typeof p.progress === "number") {
      const pct = Math.round(p.progress * 100);
      modelProgressPercent.textContent = `${pct}%`;
      modelProgressFill.style.width = `${pct}%`;
      // The percentage text is aria-hidden (re-announcing it on every tick
      // would talk over everything else); the bar carries the value instead,
      // which assistive tech reports on demand rather than out loud.
      modelProgressFill.parentElement?.setAttribute("aria-valuenow", pct);
      if (pct >= 100) {
        modelProgressHideTimer = setTimeout(
          () => modelProgress?.classList.add("hidden"),
          1500,
        );
      }
    }
  }

  if (message.type === "live-offscreen-log" && message.log) {
    if (
      debugLogsContent &&
      debugLogsCard &&
      !debugLogsCard.classList.contains("hidden")
    ) {
      const isScrollAtBottom =
        debugLogsCard.scrollHeight - debugLogsCard.clientHeight <=
        debugLogsCard.scrollTop + 10;
      if (
        debugLogsContent.textContent ===
        "No logs recorded. Try starting summary or chat."
      ) {
        debugLogsContent.textContent = "";
      }
      debugLogsContent.textContent +=
        (debugLogsContent.textContent ? "\n" : "") + message.log;
      if (isScrollAtBottom) {
        debugLogsCard.scrollTop = debugLogsCard.scrollHeight;
      }
    }
  }
});

// Playful stand-ins for "Summarizing", picked at random each time so the
// spinner isn't always the same word (same idea as Claude Code's rotating
// spinner verbs).
const SUMMARIZE_VERBS = [
  "Summarizing",
  "TL;DRing",
  "Distilling",
  "Digesting",
  "Condensing",
  "Skimming",
  "Boiling down",
  "Synthesizing",
  "Cliffnoting",
  "Compressing",
  "Untangling",
  "Cutting the fluff",
  "Getting to the point",
  "Extracting the gist",
  "Orbiting",
  "Zooming out",
  "Paraphrasing",
  "Recapping",
  "Abridging",
  "Unpacking",
  "Parsing",
  "Sifting through it",
  "Making sense of it",
  "Connecting the dots",
  "Wrapping it up",
  "Simplifying",
  "Whittling down",
  "Pruning",
  "Refining",
  "Crunching the text",
  "Chewing it over",
  "Sketching an outline",
  "Launching",
  "Stargazing",
  "Charting a course",
  "Reaching apogee",
  "Plotting a trajectory",
  "Navigating",
];

function randomSummarizeVerb() {
  return SUMMARIZE_VERBS[Math.floor(Math.random() * SUMMARIZE_VERBS.length)];
}

function setLoadingIndicator(element, label) {
  const wrapper = document.createElement("span");
  wrapper.className = "apogee-loading";
  // The same sparkle that fronts the "Summarize this page" button, spinning:
  // the mark the click started from is the thing that keeps turning while the
  // model works, the way the landing-page demo does it, rather than swapping
  // in an unrelated generic ring.
  const spinner = document.createElement("span");
  spinner.className = "apogee-spinner ico";
  spinner.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.sparkle}</svg>`;
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

// Speaks a one-off message through the off-screen live region. Streaming text
// (the summary and answer bodies) is deliberately NOT wired to a live region:
// announcing every token would be unusable, so the terminal events announce
// instead. Re-setting the same string twice in a row is a no-op for most
// screen readers, hence the clear-then-set.
function announce(message) {
  if (!a11yAnnouncer) return;
  a11yAnnouncer.textContent = "";
  a11yAnnouncer.textContent = message;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Renders `[label](url)` as a real link before the bold/italic/code passes
// below run, pulled out into placeholder tokens rather than substituted
// inline: YouTube video IDs (and their timestamp links, see
// buildYoutubeAssemblyPrompt in lib/summarize/prompts.js) routinely contain `_`/`*`,
// which would otherwise trip the italic/bold regexes into matching *across*
// an already-rendered <a href="..."> and corrupting it. Only http(s) URLs
// are linkified. escapedText is already HTML-entity-escaped by the time
// this runs (see renderMarkdown), so a `javascript:`/`data:` href couldn't
// break out of the attribute, but it could still execute on click, which
// this scheme check rules out.
//
// The href's origin is also gated: model output is steered by the page
// being summarized, so a malicious page could tell the model to emit
// "[0:12](https://evil.example/...)" and smuggle a phishing link, dressed
// as a timestamp, into the trusted popup UI. Only URLs on the summarized
// page's own host (plus youtube.com, the sole host the app itself ever
// instructs the model to link to, for jump-to-video timestamps) become real
// links; anything else renders as its plain label text instead.

// Private-Use-Area character bracketing each numeric placeholder below:
// never appears in real page text, so the restore regex in renderInline
// matches regardless of what's adjacent (a plain space-delimited digit
// missed links at the end of a line, exactly where the YouTube assembly
// prompt's headings/bullets put them; see buildYoutubeAssemblyPrompt).
const LINK_PLACEHOLDER_MARK = "\uE000";

// The video hosts are always allowed because the only links the app itself asks
// the model to produce are jump-to-moment timestamp links back to the video,
// which stay clickable even when a past video summary is rendered from an
// unrelated tab (past-summary cards have no URL to derive an origin from).
const ALWAYS_LINKIFY_HOSTS = new Set(["youtube.com", "bilibili.com"]);

// Host of the page whose summary/answer is currently being rendered; set from
// the active tab on load (see DOMContentLoaded). null = only the always-allowed
// hosts above are linkified.
let linkifyPageHost = null;

function normalizeLinkHost(host) {
  const h = host.toLowerCase().replace(/^(www\.|m\.)/, "");
  return h === "youtu.be" ? "youtube.com" : h;
}

function setLinkifyOriginFromUrl(url) {
  try {
    linkifyPageHost = normalizeLinkHost(new URL(url).hostname);
  } catch {
    linkifyPageHost = null;
  }
}

function isLinkifiableHref(href) {
  let host;
  try {
    host = normalizeLinkHost(new URL(href).hostname);
  } catch {
    return false;
  }
  return host === linkifyPageHost || ALWAYS_LINKIFY_HOSTS.has(host);
}

function extractMarkdownLinks(escapedText) {
  const links = [];
  const text = escapedText.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (match, label, href) => {
      // A cross-origin href (relative to the summarized page) is dropped to
      // its plain label rather than turned into a clickable link.
      if (!isLinkifiableHref(href)) return label;
      links.push(
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`,
      );
      return `${LINK_PLACEHOLDER_MARK}${links.length - 1}${LINK_PLACEHOLDER_MARK}`;
    },
  );
  return { text, links };
}

function renderInline(escapedText) {
  const { text, links } = extractMarkdownLinks(escapedText);
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>")
    .replace(/\uE000(\d+)\uE000/g, (_, i) => links[Number(i)]);
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

// Past summaries are rendered on Home, where the popup's linkify origin
// (linkifyPageHost) reflects whichever tab is currently active, not the tab
// the stored summary came from, whose origin we no longer have (cache entries
// only keep { s, p, t }). Rendering with that unrelated origin made a stored
// summary's links clickable-or-not depending on the current tab. Render these
// with no trusted page origin instead, so the result is deterministic: only
// always-trusted hosts (YouTube timestamps) linkify, everything else stays
// plain text.
function renderStoredSummaryMarkdown(text) {
  const savedHost = linkifyPageHost;
  linkifyPageHost = null;
  try {
    return renderMarkdown(text);
  } finally {
    linkifyPageHost = savedHost;
  }
}

// Timestamp / jump links inside the CURRENT page's summary or answer open in
// the SAME tab the popup is bound to (activeTabId), never a new tab. A video
// summary's key moments are meant to seek the very video you're watching.
// Clicking through 15 of them should move that one tab along the timeline
// (YouTube seeks to the &t=SECONDS the link carries), not pile up 15 tabs.
// Past-summary links (#pastSummariesList) are the exception: a past summary is
// for some OTHER page entirely, not the active tab, so routing its links to
// activeTabId would hijack whatever unrelated page the user currently has open.
// Those open a fresh tab instead. Delegated on document but gated to the
// markdown-rendering containers, so the popup's own chrome (settings/contact
// links) is untouched. The anchors keep target="_blank" as a safety net: if
// this handler is ever missed, a new tab still beats navigating the popup's own
// document away.
document.addEventListener("click", (e) => {
  const anchor = e.target.closest?.("a[href^='http']");
  if (!anchor) return;
  const inCurrentPageView = anchor.closest("#summaryText, #answerBox");
  const inPastSummary = anchor.closest("#pastSummariesList");
  if (!inCurrentPageView && !inPastSummary) return;
  e.preventDefault();
  const url = anchor.getAttribute("href");
  if (inCurrentPageView && activeTabId != null) {
    chrome.tabs.update(activeTabId, { url, active: true });
  } else {
    chrome.tabs.create({ url });
  }
});

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

// How many past summaries to show on Home; cacheOrder can hold up to
// MAX_CACHED_PAGES (50), far more than makes sense to list at a glance.
const PAST_SUMMARIES_SHOWN = 8;

// Strips the leading markdown marker (heading/bullet/number) off the first
// non-empty line so the preview reads as plain text instead of literally
// showing "# " or "- ".
function firstLineOf(text) {
  const lines = (text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  // A video / chaptered-brief summary opens with a "## Summary" / "## Overview"
  // heading (see buildYoutubeAssemblyPrompt / buildYoutubeBriefPrompt); using
  // that heading as the card preview would label every video the same word.
  // Prefer the first line of actual content, falling back to the heading only
  // if the summary is nothing but headings.
  const line =
    lines.find((l) => !/^#{1,6}\s+/.test(l.trim())) || lines[0] || "";
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "");
}

// Populates Home's "Past Summaries" list from the same cache persistSummary
// writes to (see MAX_CACHED_PAGES above), most recent first. Hidden
// entirely when there's nothing cached yet (fresh install) or after
// "Clear cached summaries & page data".
async function loadPastSummaries() {
  const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
  if (cacheOrder.length === 0) {
    pastSummariesSection.classList.add("hidden");
    pastSummariesList.innerHTML = "";
    return;
  }

  const recent = cacheOrder.slice(-PAST_SUMMARIES_SHOWN).reverse();
  const stored = await chrome.storage.local.get(recent.map((e) => e.s));

  pastSummariesList.innerHTML = "";
  for (const entry of recent) {
    const text = stored[entry.s];
    if (!text) continue; // evicted/cleared since cacheOrder was written

    // A <div> (not <button>), because it needs to contain the copy button
    // below, and <button> can't nest inside <button> (the browser silently
    // breaks the inner one). role="button" + the keydown handler keep it
    // keyboard-operable in place of the native semantics that loses.
    const card = document.createElement("div");
    card.className = "past-summary-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    // Collapsed by default; toggleExpanded keeps this in sync so the state
    // is conveyed rather than left to the visual change alone.
    card.setAttribute("aria-expanded", "false");

    // Groups the (optional) title and preview into one flex item so the
    // copy button below can sit alongside both instead of just the preview.
    const textWrap = document.createElement("div");
    textWrap.className = "past-summary-text";

    // Entries persisted before persistSummary started threading a title
    // through have no `t`, fall back to showing just the preview, same as
    // before this field existed.
    if (entry.t) {
      const titleEl = document.createElement("div");
      titleEl.className = "past-summary-title";
      titleEl.textContent = entry.t;
      textWrap.appendChild(titleEl);
    }

    const preview = document.createElement("div");
    preview.className = "past-summary-preview";
    preview.textContent = firstLineOf(text);
    textWrap.appendChild(preview);
    card.appendChild(textWrap);

    const toggleExpanded = () => {
      const expanded = card.classList.toggle("expanded");
      card.setAttribute("aria-expanded", String(expanded));
      if (expanded) preview.innerHTML = renderStoredSummaryMarkdown(text);
      else preview.textContent = firstLineOf(text);
    };
    card.addEventListener("click", (e) => {
      // A link inside an expanded card (e.g. a YouTube timestamp) should
      // follow the link without also toggling the card collapsed underneath.
      if (e.target.closest("a")) return;
      toggleExpanded();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleExpanded();
      }
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.setAttribute("aria-label", "Copy this summary");
    copyBtn.innerHTML = icon("copy");
    copyBtn.addEventListener("click", (e) => {
      // Otherwise this bubbles up to the card's own click handler and
      // toggles expand/collapse at the same time as copying.
      e.stopPropagation();
      copyToClipboard(text, copyBtn);
    });

    // Decorative: the card itself is the toggle (role="button" above), this
    // just gives the collapsed row a visible hint that it opens. CSS flips it
    // on .expanded.
    const chevron = document.createElement("span");
    chevron.className = "past-summary-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.innerHTML = icon("chevron");

    const actions = document.createElement("div");
    actions.className = "past-summary-actions";
    actions.append(copyBtn, chevron);
    card.appendChild(actions);

    pastSummariesList.appendChild(card);
  }

  pastSummariesSection.classList.toggle(
    "hidden",
    pastSummariesList.children.length === 0,
  );
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
  setSummaryCopyButtonsVisible(false);
  updateTimeSavedBadge(null, null);
}

// Sets (or, for a null/empty label, hides) the badge. Shared by the live path
// below and the restore-from-cache path (showTimeSavedFromInputs) so both
// render the badge identically.
function setTimeSavedBadgeLabel(label) {
  if (!timeSavedBadge) return;
  timeSavedBadge.textContent = label || "";
  timeSavedBadge.classList.toggle("hidden", !label);
}

// Live path: compute + show the badge from the in-memory page data right after
// a summarize job finishes. Video pages (YouTube, Bilibili, see isVideoType)
// measure against the video's actual runtime (durationSeconds); everything else
// against the original text's word count. On reopen, showTimeSavedFromInputs
// takes over from persisted inputs.
function updateTimeSavedBadge(pageData, summaryText) {
  const label = isVideoType(pageData?.type)
    ? formatVideoTimeSaved(pageData.durationSeconds, summaryText)
    : formatTimeSaved(pageData?.content, summaryText);
  setTimeSavedBadgeLabel(label);
}

// Re-shows the badge when a finished summary is restored from cache on popup
// reopen: the live page data (currentPageData) is gone by then, but the inputs
// the badge needs were persisted into the tab's view state on completion (see
// consumeSummaryStream), so recompute from those against the restored summary.
// Without this the badge would appear once, then vanish the first time the
// popup closed and reopened. `inputs` absent (e.g. an older cached summary
// saved before this was persisted, or a background job) → badge stays hidden.
function showTimeSavedFromInputs(inputs, summaryText) {
  setTimeSavedBadgeLabel(formatTimeSavedFromInputs(inputs, summaryText));
}

// Shared by every place that shows/hides the summary card's copy buttons
// (plain text and Markdown) and the Resummarize button in lockstep, so a
// spot that toggles one can't accidentally leave the others stale. All three
// only make sense once a finished summary is actually on screen.
function setSummaryCopyButtonsVisible(hasText) {
  copySummaryBtn.classList.toggle("hidden", !hasText);
  copyMarkdownBtn?.classList.toggle("hidden", !hasText);
  resummarizeBtn?.classList.toggle("hidden", !hasText);
}

// Copies plain text (not the rendered HTML) to the clipboard and briefly
// swaps the button's icon to a checkmark so the click has visible feedback,
// same pattern for both the summary and answer copy buttons.
async function copyToClipboard(text, btn) {
  if (!text || !btn) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Clipboard permission denied or unavailable; nothing sensible to do
    // beyond not showing the "copied" confirmation below. Logged (not
    // silently swallowed) since a failed copy with no feedback at all is
    // otherwise indistinguishable from "worked, but the checkmark simply
    // wasn't noticed".
    console.error("Copy to clipboard failed:", err);
    return;
  }
  announce("Copied to clipboard.");
  const original = btn.innerHTML;
  btn.innerHTML = icon("check");
  clearTimeout(btn._copyResetTimer);
  btn._copyResetTimer = setTimeout(() => {
    btn.innerHTML = original;
  }, 1500);
}

copySummaryBtn?.addEventListener("click", () =>
  copyToClipboard(currentSummaryText, copySummaryBtn),
);
copyMarkdownBtn?.addEventListener("click", async () => {
  // currentPageData isn't always populated (e.g. right after reopening the
  // popup on a cached summary, see getPageData's known gap), so fall back
  // to the active tab's own title/url, always available regardless.
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const title = currentPageData?.title || tab?.title || "";
  const url = currentPageData?.url || tab?.url || "";
  const markdown = formatSummaryAsMarkdown({
    title,
    url,
    summary: currentSummaryText,
  });
  copyToClipboard(markdown, copyMarkdownBtn);
});
copyAnswerBtn?.addEventListener("click", () =>
  copyToClipboard(currentAnswerText, copyAnswerBtn),
);
resummarizeBtn?.addEventListener("click", () => summarizeActivePage());

function showCancelSummarizeButton(streamId) {
  activeSummarizeStreamId = streamId;
  cancelSummarizeBtn.textContent = "Cancel";
  cancelSummarizeBtn.disabled = false;
  cancelSummarizeBtn.classList.remove("hidden");
}

function hideCancelSummarizeButton() {
  activeSummarizeStreamId = null;
  cancelSummarizeBtn.classList.add("hidden");
  // Runs on every terminal outcome of a summarize job (done/cancelled/
  // error, see this function's callers), so a lingering "model-progress"
  // banner (e.g. "Summarizing part 2 of 3..." at a permanent 0%, which
  // never crosses the >=100% threshold that otherwise auto-hides it) can't
  // outlive the job that was reporting it.
  modelProgress?.classList.add("hidden");
}

// Shared by a freshly started summarize job and one resumed after the popup
// was reopened mid-stream. Cancellation itself is handled by the caller
// (navigates back to the home view instead), this only renders a real
// failure.
function renderSummaryError(error) {
  console.error(error);
  const p = document.createElement("p");
  // role="alert" so the failure is spoken the moment it replaces the
  // streaming summary; everything else in the popup announces politely, but
  // a dead job is the one thing worth interrupting for.
  p.setAttribute("role", "alert");
  p.style.color = "var(--error-text)";
  p.style.fontSize = "13px";
  p.textContent = error.message;
  summaryText.textContent = "";
  summaryText.appendChild(p);
}

// On cancel there's no partial summary worth keeping the user parked on, so
// send them back to Home rather than showing a "cancelled" state in place.
// Clears the persisted streamId too, otherwise reopening the popup would
// try to reattach to the now-dead job (see the resume logic below).
function returnHomeAfterCancel(tabId) {
  showOnlyView("homeView");
  saveViewState(tabId, { view: "homeView", streamId: null });
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
  copyAnswerBtn.classList.add("hidden");
}

function showAskContext() {
  summaryCard.classList.add("hidden");
  // Unlike showAnswerContext (which reuses promptsSection to show the
  // submitted question), there's nothing to show here yet: no page has been
  // summarized, so there are no real suggestions, just an empty "Suggested
  // Prompts" heading with nothing under it.
  promptsSection.classList.add("hidden");
  answerHeading.textContent = "Ask Apogee";
  resetQuestionCards();
  chatSection.classList.remove("hidden");
  questionInput.classList.remove("hidden");
  sendBtn.classList.remove("hidden");
  answerBox.classList.add("hidden");
  questionInput.value = "";
  answerBox.textContent = "";
  togglePromptsBtn.style.display = "none";
  copyAnswerBtn.classList.add("hidden");
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
  copyAnswerBtn.classList.add("hidden");
  setLoadingIndicator(answerBox, "Thinking");
}

function showCancelAskButton(streamId) {
  activeAskStreamId = streamId;
  cancelAskBtn.textContent = "Cancel";
  cancelAskBtn.disabled = false;
  cancelAskBtn.classList.remove("hidden");
}

function hideCancelAskButton() {
  activeAskStreamId = null;
  cancelAskBtn.classList.add("hidden");
  // See hideCancelSummarizeButton's comment: same lingering-banner issue,
  // e.g. "Reconnecting to local model..." shown while re-creating the
  // offscreen document for an ask's RAG lookup.
  modelProgress?.classList.add("hidden");
}

// Mirrors returnHomeAfterCancel, but for a cancelled "ask": there's still a
// summary/page context worth staying on, so this returns to the question
// input instead of leaving summaryView entirely.
function returnToAskAfterCancel(tabId) {
  showAskContext();
  saveViewState(tabId, { view: "summaryView", subview: "ask", streamId: null });
}

cancelAskBtn?.addEventListener("click", () => {
  if (!activeAskStreamId) return;
  cancelAskBtn.disabled = true;
  cancelAskBtn.textContent = "Cancelling...";
  cancelStream(activeAskStreamId);
});

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
async function consumeSummaryStream(stream, { tab, promptsCacheKey }) {
  const text = await streamGeneratorIntoElement(stream, summaryText);

  currentSummaryText = text;
  makeSummaryPassagesFocusable();
  showSummaryContext();
  setSummaryCopyButtonsVisible(!!text.trim());
  // The just-finished summary matches the current setting, so clear any stale
  // language hint that may have been showing before this re-run.
  updateResummarizeHint();
  updateTimeSavedBadge(currentPageData, text);
  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "summary",
    url: tab.url,
    streamId: null,
    // Persist just the inputs the badge needs (video runtime or original word
    // count) so it can be recomputed and shown again when this summary is
    // restored from cache on a later popup open, instead of vanishing.
    timeSaved: timeSavedInputsFor({
      type: currentPageData?.type,
      durationSeconds: currentPageData?.durationSeconds,
      content: currentPageData?.content,
    }),
  });
  setSuggestedQuestionsLoading();

  // The service worker's finalizeSummaryJob (triggered by this same
  // summarize job finishing, see background/service-worker.js) is what
  // actually persists the summary and kicks off suggested-question
  // generation now, not this function, that's what lets a finished summary
  // survive even if the popup is closed before the job wraps up. This just
  // needs to watch for the result: set currentPromptsCacheKey so the
  // storage.onChanged/"suggested-prompts-ready" listeners above route to
  // this popup, and also check storage directly here in case that
  // background job already finished (e.g. reattaching after the popup was
  // closed and reopened) before either listener had a chance to attach.
  currentPromptsCacheKey = promptsCacheKey;
  const { [promptsCacheKey]: existingQuestions } =
    await chrome.storage.local.get(promptsCacheKey);
  if (existingQuestions !== undefined) {
    setSuggestedQuestions(
      Array.isArray(existingQuestions) ? existingQuestions : [],
    );
  }
  return text;
}

async function summarizeActivePage() {
  // A prior summarize job (e.g. Home -> Summarize -> logo back to Home ->
  // Summarize again before the first one finished) otherwise keeps
  // generating in the background for up to 2 minutes with nothing
  // subscribed to it, wasted GPU/CPU for output no one will see. This also
  // stops that job's still-running consumeSummaryStream loop, if any, from
  // racing this one to write into the same DOM elements below.
  if (activeSummarizeStreamId) {
    cancelStream(activeSummarizeStreamId);
  }
  homeView.classList.add("hidden");
  summaryView.classList.remove("hidden");
  showSummarizingContext();
  setLoadingIndicator(summaryText, randomSummarizeVerb());

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
    // The summary about to be generated will be in this language; record it so
    // a later language-setting change can flag the result as stale.
    currentSummaryLanguage = settings.summaryLanguage;
    // Explicit "Summarize" click always re-reads the live page, unlike
    // getPageData()'s reuse path (used by follow-up questions), we don't
    // want a stale cached extraction here.
    const pageData = await extractFromActiveTab(tab);

    if (!pageData) {
      summaryText.textContent =
        "Couldn't read this page, try reloading it, or pick a different tab.";
      return;
    }
    // Gmail returns empty content when no thread is open rather than
    // dumping the inbox chrome, surface that instead of sending blank
    // content to the model.
    if (!pageData.isPdf && !pageData.content) {
      summaryText.textContent =
        "Nothing to summarize here yet, open a page, email, or video first.";
      return;
    }
    currentPageData = pageData;
    if (
      CACHEABLE_PAGE_TYPES.has(pageData.type) &&
      (await shouldPersist(tab.url))
    ) {
      await persistContent(tab.url, pageData);
    }

    const cacheKey = await getSummaryCacheKey(
      tab.url,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
    );
    const promptsCacheKey = await getPromptsCacheKey(
      tab.url,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
    );
    // Read once here (rather than after the stream finishes) and threaded
    // through as `finalize`: the service worker is what actually persists
    // the summary and kicks off suggested questions once the job completes
    // (see finalizeSummaryJob in background/service-worker.js), so it needs
    // this up front, not just this popup instance if it happens to still be
    // open by then.
    const finalize = {
      cacheKey,
      promptsCacheKey,
      persist: await shouldPersist(tab.url),
      providerType: getProviderType(settings),
      host: settings.ollamaHost,
      notifyOnFinish: false,
      language: settings.summaryLanguage,
      translationEngine: settings.translationEngine,
    };

    let streamId, stream;

    if (pageData.isPdf) {
      setLoadingIndicator(summaryText, "Extracting PDF");
      const pdfContent = await extractPdfContent(tab);
      if (!pdfContent) {
        summaryText.textContent =
          "Couldn't pull any text out of this PDF, it might be a scanned image.";
        return;
      }
      pageData.content = pdfContent;
      setLoadingIndicator(summaryText, randomSummarizeVerb());
      ({ streamId, stream } = await provider.summarize({
        title: pageData.title,
        url: pageData.url,
        content: pdfContent,
        mode: settings.responseFormat,
        language: settings.summaryLanguage,
        translationEngine: settings.translationEngine,
        finalize,
      }));
    } else {
      ({ streamId, stream } = await provider.summarize({
        title: pageData.title,
        url: pageData.url,
        content: pageData.content,
        mode: settings.responseFormat,
        type: pageData.type,
        language: settings.summaryLanguage,
        translationEngine: settings.translationEngine,
        finalize,
      }));
    }

    await saveViewState(tab.id, {
      view: "summaryView",
      subview: "summarizing",
      url: tab.url,
      streamId,
      promptsCacheKey,
    });
    showCancelSummarizeButton(streamId);

    await consumeSummaryStream(stream, { tab, promptsCacheKey });
    announce("Summary ready.");
  } catch (error) {
    if (error instanceof StreamCancelledError) {
      returnHomeAfterCancel(activeTabId);
    } else {
      renderSummaryError(error);
    }
  } finally {
    hideCancelSummarizeButton();
  }
}

cancelSummarizeBtn?.addEventListener("click", () => {
  if (!activeSummarizeStreamId) return;
  cancelSummarizeBtn.disabled = true;
  cancelSummarizeBtn.textContent = "Cancelling...";
  cancelStream(activeSummarizeStreamId);
});

// Shown in place of the answer when a question comes back empty, both live
// (consumeAnswerStream) and when restoring a previously-empty answer.
const EMPTY_ANSWER_MESSAGE =
  "No answer came back - try rephrasing the question.";

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
  // A model that streams back nothing usable (empty or all-whitespace) would
  // otherwise leave a blank bordered box, indistinguishable from a glitch.
  else answerBox.textContent = EMPTY_ANSWER_MESSAGE;

  currentAnswerText = fullText;
  copyAnswerBtn.classList.toggle("hidden", !started);
  announce(started ? "Answer ready." : EMPTY_ANSWER_MESSAGE);

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
  // See the matching comment in summarizeActivePage: stop wasting
  // generation on a still-running prior question nobody's waiting on
  // anymore, and stop it from racing this one into answerBox.
  if (activeAskStreamId) {
    cancelStream(activeAskStreamId);
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
    // Reuse cached page data (in-memory or persisted) when it's safe to,
    // see getPageData()/CACHEABLE_PAGE_TYPES for why Gmail/YouTube are
    // always re-extracted live instead.
    let pageData = await getPageData(tab);
    if (!pageData) {
      answerBox.textContent =
        "Couldn't read this page, try reloading it, or pick a different tab.";
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
      language: settings.summaryLanguage,
      translationEngine: settings.translationEngine,
    });

    await saveViewState(tab.id, {
      view: "summaryView",
      subview: "answer",
      url: tab.url,
      streamId,
      question: trimmed,
    });
    showCancelAskButton(streamId);

    await consumeAnswerStream(stream, { tab, question: trimmed });
  } catch (error) {
    if (error instanceof StreamCancelledError) {
      returnToAskAfterCancel(activeTabId);
    } else {
      console.error(error);
      answerBox.textContent = error.message;
    }
  } finally {
    hideCancelAskButton();
  }
}

// Returns the provider's full checkReady() result (not just a boolean):
// DirectOllamaProvider's includes `models`, the live list from Ollama's own
// /api/tags (see ollamaClient.js's checkHealth), which updateLocalModelList
// uses to replace the hardcoded LOCAL_MODELS list with whatever the user has
// actually pulled.
async function checkConnection() {
  const settings = await getSettings();
  const provider = getProvider(settings);
  return await provider.checkReady();
}

// Populates the Local Ollama model list from that live result, so users
// aren't limited to the 4 models baked into LOCAL_MODELS. Falls back to that
// hardcoded list when Ollama isn't reachable or reports no models, so the
// settings page still shows something sensible before Ollama is running.
function updateLocalModelList(settings, status) {
  if (settings.provider !== PROVIDERS.LOCAL) return;

  const liveModels = Array.isArray(status?.models) ? status.models : [];
  if (liveModels.length > 0) {
    // Keep the currently selected model in the list even if this Ollama
    // response doesn't include it (e.g. it was picked before Ollama was
    // reachable), so switching providers/reopening never silently changes
    // the user's choice out from under them.
    const names = liveModels.includes(settings.localModel)
      ? liveModels
      : [settings.localModel, ...liveModels];
    buildLocalModelUI(
      settings.localModel,
      names.map((name) => ({ id: name, label: name })),
    );
    if (localModelStatus) {
      localModelStatus.textContent =
        `${liveModels.length} model${liveModels.length === 1 ? "" : "s"} ` +
        "found on this Ollama instance.";
    }
  } else {
    buildLocalModelUI(settings.localModel, LOCAL_MODELS);
    if (localModelStatus) {
      // `status.error` (set by DirectOllamaProvider.checkReady when the
      // service worker rejected the host itself, e.g. a scheme other than
      // http:// or a non-loopback hostname) is a specific, actionable
      // reason; without it, an invalid host just read as the same generic
      // "connect to Ollama to see yours" as Ollama simply not running yet.
      localModelStatus.textContent = status?.error
        ? status.error
        : status?.ready
          ? "No models found on this Ollama instance, pull one with `ollama pull <model>`."
          : "Showing default models, connect to Ollama to see yours.";
    }
  }
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

  // Views swap in place, so without moving focus a screen reader stays parked
  // on whatever it was reading in the view that just went display:none, and
  // the next Tab lands back at the top of the document. Each view container
  // carries tabindex="-1" + aria-label for exactly this: focusing it
  // announces the view the user just navigated to. preventScroll keeps the
  // popup from jumping when a long view (Settings) is focused.
  const target = document.getElementById(view);
  target?.focus({ preventScroll: true });
}

// Shows the actual current "Summarize this page" keyboard shortcut on its
// button, read live via chrome.commands.getAll() rather than hardcoding the
// manifest's suggested_key: the user can remap it any time via
// chrome://extensions/shortcuts (or unbind it entirely), and a hardcoded
// hint would silently go stale the moment they did, same reasoning as
// reading the version from the manifest instead of a literal string above.
async function updateSummarizeShortcutHint() {
  if (!summarizeShortcutHint || typeof chrome.commands?.getAll !== "function") {
    return;
  }
  const commands = await chrome.commands.getAll();
  const command = commands.find((c) => c.name === "summarize-page");
  if (command?.shortcut) {
    summarizeShortcutHint.textContent = command.shortcut;
    summarizeShortcutHint.classList.remove("hidden");
  } else {
    // Unbound (user cleared it in chrome://extensions/shortcuts, or it
    // never registered on this platform), nothing to show.
    summarizeShortcutHint.classList.add("hidden");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // WebLLM (WebGPU via an offscreen document) only exists on Chrome/Edge;
  // Firefox has no offscreen API at all, so hide that radio there. Chrome/Edge
  // keep BOTH in-browser providers, WebLLM (default) and Transformers.js
  // (ONNX/WASM, opt-in), so nothing is hidden there (see PROVIDERS in
  // lib/constants.js). Don't offer a provider getProvider() can't construct.
  if (process.env.TARGET_BROWSER === "firefox") {
    webllmProviderOption?.classList.add("hidden");
  }

  try {
    // Independent of settings/connection-check/tab below, and those can be
    // slow (or hang, if the provider never responds), so this isn't awaited
    // here, it just populates Home in the background on its own schedule.
    loadPastSummaries().catch((err) => console.error(err));
    updateSummarizeShortcutHint().catch((err) => console.error(err));

    const settings = await getSettings();
    await applySettingsToUI(settings);

    // Not awaited, same reasoning as loadPastSummaries above: probing
    // connectivity can create the offscreen document (WebLLM) or hit an
    // unreachable Ollama host, either of which can take seconds, and
    // nothing below (which view to restore) depends on the result.
    checkConnection()
      .then((status) => {
        updateConnectionUI(status?.ready === true);
        updateLocalModelList(settings, status);
      })
      .catch((err) => console.error(err));

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    activeTabId = tab.id;
    // The popup stays bound to this one tab (it doesn't follow tab switches),
    // so this host governs which links in every summary/answer rendered below
    // are trusted enough to become clickable, see extractMarkdownLinks.
    setLinkifyOriginFromUrl(tab.url);

    const state = await loadViewState(tab.id);

    // Mid-summarize or mid-answer when the popup last closed: the job kept
    // running in the background, so reattach instead of restarting it.
    // States are matched by URL hash (see saveViewState); states written by
    // older versions stored a raw `url` instead and simply read as stale.
    if (state && state.urlHash === (await hashUrl(tab.url)) && state.streamId) {
      if (state.subview === "summarizing") {
        showOnlyView("summaryView");
        showSummarizingContext();
        setLoadingIndicator(summaryText, randomSummarizeVerb());
        showCancelSummarizeButton(state.streamId);
        try {
          // Not consumed directly below (consumeSummaryStream no longer
          // needs pageData, the service worker's finalizeSummaryJob owns
          // persistence now, see that function's own comment), but still
          // worth populating currentPageData's in-memory reuse for any
          // follow-up "Ask" click on this same page.
          await getPageData(tab);
          await consumeSummaryStream(attachToStream(state.streamId), {
            tab,
            promptsCacheKey: state.promptsCacheKey,
          });
        } catch (error) {
          if (error instanceof StreamCancelledError) {
            returnHomeAfterCancel(tab.id);
          } else {
            renderSummaryError(error);
            // Clear the dead stream pointer so reopening the popup doesn't
            // retry the same failed reattach forever, the underlying job is
            // gone either way (evicted service worker, crashed offscreen
            // engine, etc.), so there's nothing left to reattach to.
            await saveViewState(tab.id, { streamId: null });
          }
        } finally {
          hideCancelSummarizeButton();
        }
        return;
      }

      if (state.subview === "answer") {
        showOnlyView("summaryView");
        showAnswerContext(state.question || "");
        showCancelAskButton(state.streamId);
        try {
          await consumeAnswerStream(attachToStream(state.streamId), {
            tab,
            question: state.question || "",
          });
        } catch (error) {
          if (error instanceof StreamCancelledError) {
            returnToAskAfterCancel(tab.id);
          } else {
            console.error(error);
            answerBox.textContent = error.message;
            // Same reasoning as the summarize reattach above, don't leave a
            // dead streamId behind for the next popup open to retry.
            await saveViewState(tab.id, { streamId: null });
          }
        } finally {
          hideCancelAskButton();
        }
        return;
      }
    }

    // No in-flight job, restore whichever static page the user was last on.
    if (state && state.urlHash === (await hashUrl(tab.url))) {
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
          currentAnswerText = state.answerText || "";
          if (currentAnswerText.trim()) {
            answerBox.innerHTML = renderMarkdown(currentAnswerText);
          } else {
            answerBox.textContent = EMPTY_ANSWER_MESSAGE;
          }
          copyAnswerBtn.classList.toggle("hidden", !currentAnswerText.trim());
          return;
        }
        if (state.subview === "ask") {
          showOnlyView("summaryView");
          showAskContext();
          questionInput.focus();
          return;
        }
        if (state.subview === "summary" && state.summaryText) {
          // A background "Summarize selection" job parked its finished result
          // here (see finalizeSummaryJob): it's deliberately not in the
          // URL-keyed page cache, so render this inline text directly rather
          // than falling through to the cache lookup below, which would only
          // ever find the real page summary (or nothing).
          currentSummaryText = state.summaryText;
          currentSummaryLanguage = settings.summaryLanguage;
          summaryText.innerHTML = renderMarkdown(state.summaryText);
          makeSummaryPassagesFocusable();
          setSummaryCopyButtonsVisible(!!state.summaryText.trim());
          updateResummarizeHint(settings);
          showTimeSavedFromInputs(state.timeSaved, state.summaryText);
          showOnlyView("summaryView");
          const selPromptsKey = state.promptsCacheKey;
          const stored = selPromptsKey
            ? await chrome.storage.local.get(selPromptsKey)
            : {};
          if (selPromptsKey && stored[selPromptsKey] !== undefined) {
            showSummaryContext(stored[selPromptsKey]);
          } else {
            showSummaryContext([]);
            setSuggestedQuestionsLoading();
            startSuggestedQuestionsBg(
              selPromptsKey,
              {
                title: tab.title || "",
                url: tab.url,
                summary: state.summaryText,
              },
              settings,
              // Selection summaries never persist, so neither do their
              // suggested questions; they arrive live via the listeners above.
              false,
            );
          }
          return;
        }
        // subview === "summary" (or unknown) falls through to the cache
        // lookup below, which is the source of truth for summary text.
      }
    }

    const model = getModelForSettings(settings);
    const cacheKey = await getSummaryCacheKey(
      tab.url,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
    );
    const promptsCacheKey = await getPromptsCacheKey(
      tab.url,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
    );
    const cached = await chrome.storage.local.get([cacheKey, promptsCacheKey]);

    if (cached[cacheKey]) {
      currentSummaryText = cached[cacheKey];
      // A cache hit is keyed by the current summaryLanguage, so the restored
      // summary is, by construction, in the currently-selected language.
      currentSummaryLanguage = settings.summaryLanguage;
      summaryText.innerHTML = renderMarkdown(cached[cacheKey]);
      makeSummaryPassagesFocusable();
      setSummaryCopyButtonsVisible(!!cached[cacheKey].trim());
      updateResummarizeHint(settings);
      // Restore the "time saved" badge from the inputs persisted alongside this
      // tab's view state, so it survives the popup closing and reopening. Only
      // trust those inputs when the stored state is for THIS url: the cache
      // lookup here runs unconditionally (outside the urlHash gate above), so a
      // stale state left by a different page previously open in the same tab
      // would otherwise size the badge against the wrong original (e.g. a past
      // video's runtime applied to an article's cached summary).
      const badgeInputs =
        state && state.urlHash === (await hashUrl(tab.url))
          ? state.timeSaved
          : null;
      showTimeSavedFromInputs(badgeInputs, cached[cacheKey]);
      showOnlyView("summaryView");
      // A present key (even []) means prompts finished; a missing key means
      // they were still generating when the popup closed, show loading and
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
  settingsEntryView = "homeView";
  showOnlyView("settingsView");
  saveViewState(activeTabId, { view: "settingsView" });
});

settingsBtn2?.addEventListener("click", () => {
  settingsEntryView = "summaryView";
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
// itself, see getSummaryCacheKey.
providerRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const settings = await saveSettings({ provider: radio.value });
    await applySettingsToUI(settings);
    const status = await checkConnection();
    updateConnectionUI(status?.ready === true);
    updateLocalModelList(settings, status);
  });
});

formatRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ responseFormat: radio.value });
  });
});

// Keeps the "N / 2000" counter under the custom-instructions box in sync.
function updateCustomInstructionsCount() {
  if (!customInstructionsCount || !customInstructionsInput) return;
  const len = customInstructionsInput.value.length;
  customInstructionsCount.textContent = `${len} / ${CUSTOM_INSTRUCTIONS_MAX_CHARS}`;
}

if (customInstructionsInput) {
  // Update the counter live on every keystroke, but only persist once the user
  // pauses/leaves the field: saving on every keystroke would thrash
  // chrome.storage. The maxlength attribute caps input in the DOM; slice() here
  // is defensive against a paste that somehow exceeds it (and matches the
  // model-side CUSTOM_INSTRUCTIONS_MAX_CHARS budget).
  let customInstructionsSaveTimer = null;
  const persistCustomInstructions = async () => {
    const value = customInstructionsInput.value
      .slice(0, CUSTOM_INSTRUCTIONS_MAX_CHARS)
      .trim();
    await saveSettings({ customInstructions: value });
  };

  customInstructionsInput.addEventListener("input", () => {
    updateCustomInstructionsCount();
    clearTimeout(customInstructionsSaveTimer);
    customInstructionsSaveTimer = setTimeout(persistCustomInstructions, 500);
  });
  customInstructionsInput.addEventListener("blur", () => {
    clearTimeout(customInstructionsSaveTimer);
    persistCustomInstructions();
  });
}

summaryLanguageSelect?.addEventListener("change", async () => {
  const settings = await saveSettings({
    summaryLanguage: summaryLanguageSelect.value,
  });
  // Changing the language doesn't auto-regenerate (same as Response Format);
  // surface the mismatch so the visible summary can be refreshed on demand.
  await updateResummarizeHint(settings);
});

translationEngineRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ translationEngine: radio.value });
  });
});

themeRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const settings = await saveSettings({ theme: radio.value });
    applyTheme(settings.theme);
  });
});

saveHistoryRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ saveHistory: radio.value === "on" });
  });
});

sponsorBlockRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ useSponsorBlock: radio.value === "on" });
  });
});

// Same `debugLogs` setting the summary view's "Show logs" panel writes (see
// toggleDebugLogsBtn). Settings is the copy you can reach *before* starting a
// job, which is what a bug reporter needs: that panel only exists while the
// model-progress banner is on screen, so arming it there always missed the
// run that was being reported. Both controls live in the same popup document,
// so whichever one is used has to move the other.
function syncDebugLogsRadios(on) {
  debugLogsRadios.forEach((radio) => {
    radio.checked = radio.value === (on ? "on" : "off");
  });
}

debugLogsRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ debugLogs: radio.value === "on" });
  });
});

// Removes every persisted summary, suggested-prompt set, extracted page body,
// and per-tab view state (plus their FIFO indexes), the "clear cached data"
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
    currentSummaryLanguage = null;
    updateResummarizeHint();
    await loadPastSummaries();
    if (clearDataStatus) clearDataStatus.textContent = "Cached data cleared.";
  } catch (err) {
    if (clearDataStatus) clearDataStatus.textContent = `Error: ${err.message}`;
  } finally {
    clearDataBtn.disabled = false;
  }
});

backendUrlInput?.addEventListener("change", async () => {
  let val = (backendUrlInput.value || DEFAULT_OLLAMA_HOST).trim();
  // A bare host:port (e.g. "127.0.0.1:11434", easy to type without
  // thinking of it as a URL) otherwise fails validateOllamaHost's `new
  // URL()` parse in the service worker and just reads as "Disconnected"
  // with no indication why.
  if (val && !/^https?:\/\//i.test(val)) {
    val = `http://${val}`;
  }
  val = val.replace(/\/+$/, "");
  backendUrlInput.value = val;
  const settings = await saveSettings({ ollamaHost: val });
  await applySettingsToUI(settings);
  const status = await checkConnection();
  updateConnectionUI(status?.ready === true);
  updateLocalModelList(settings, status);
});

promptsCloseBtn?.addEventListener("click", () => {
  promptsSection.classList.add("hidden");
  togglePromptsBtn.style.display = "flex";
});

togglePromptsBtn?.addEventListener("click", () => {
  promptsSection.classList.remove("hidden");
  togglePromptsBtn.setAttribute("aria-expanded", "true");
  togglePromptsBtn.style.display = "none";
});

getInTouchBtn?.addEventListener("click", () => {
  showOnlyView("contactView");
  saveViewState(activeTabId, { view: "contactView" });
});

// Only Home and Summary show the logo (Settings/Contact use a back-arrow
// header instead), clicking it acts as a "go home" shortcut from Summary.
document.querySelectorAll(".brand").forEach((brand) => {
  brand.addEventListener("click", () => {
    showOnlyView("homeView");
    saveViewState(activeTabId, { view: "homeView" });
    // Refresh in case a summary was generated (or cleared) earlier in this
    // same popup session; Home otherwise only reloads this on reopen.
    loadPastSummaries();
  });
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
  showOnlyView(settingsEntryView);
  // summaryView's own subview/promptsCacheKey fields (set when the summary
  // finished, see consumeSummaryStream) are untouched by this merge, so
  // navigating back there doesn't disturb what's actually being resumed on
  // a later popup reopen, just which page is currently on screen.
  saveViewState(activeTabId, { view: settingsEntryView });
  // Returning to a summary after possibly changing the language in Settings:
  // re-evaluate whether the on-screen summary is now in a stale language.
  if (settingsEntryView === "summaryView") updateResummarizeHint();
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

// Highlight-in-page: click a summary bullet/line, scroll to and highlight
// the matching passage in the live page, so the model's claims are visibly
// grounded in the source text. Needs the on-device embedding pipeline,
// which only runs in the offscreen document (see "find-passage" in
// background/service-worker.js, same Chrome/Edge-only constraint Ask's own
// retrieval already has), so this is a no-op on Firefox: no listener is
// attached, and summaryText doesn't get the CSS class that gives bullets
// their clickable affordance in the first place.
const HIGHLIGHT_SUPPORTED = process.env.TARGET_BROWSER !== "firefox";

// A dot-product similarity below this is treated as "not actually the same
// claim", not just a loose match, since the top-scoring chunk is always
// returned even when nothing on the page is a good fit (e.g. a bullet that
// synthesizes several parts of the page at once). This threshold is a
// starting point, not empirically tuned against real model output, expect
// to revisit it based on how often real clicks land on false positives vs.
// unnecessary "couldn't locate" misses.
const HIGHLIGHT_MIN_SCORE = 0.35;

function showLocateFailure(target) {
  target.classList.add("apogee-locate-failed");
  const note = document.createElement("span");
  note.className = "apogee-locate-note";
  note.textContent = " (couldn't locate this passage on the page)";
  target.appendChild(note);
  setTimeout(() => {
    target.classList.remove("apogee-locate-failed");
    note.remove();
  }, 2500);
}

async function locateAndHighlight(target) {
  if (target.classList.contains("apogee-locating")) return;
  const query = target.textContent.trim();
  if (!query) return;

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab) return;

  target.classList.add("apogee-locating");
  try {
    // currentPageData isn't always populated at this point, e.g. right
    // after reopening the popup on a cached summary (see getPageData's
    // known gap), so populate it lazily here before the first lookup.
    if (!currentPageData?.content) {
      await getPageData(tab);
    }
    const content = currentPageData?.content;
    if (!content) {
      showLocateFailure(target);
      return;
    }

    const response = await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "find-passage",
      payload: { content, query },
    });
    const passage = response?.passage;
    if (!passage || passage.score < HIGHLIGHT_MIN_SCORE) {
      showLocateFailure(target);
      return;
    }

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      css: `::highlight(apogee-grounding) { background-color: rgba(255, 205, 0, 0.55); color: #1a1a1a; }`,
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["/content/highlight.js"],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (chunk) => window.__apogeeHighlight(chunk),
      args: [passage.chunk],
    });
    const result = results?.[0]?.result;
    if (!result?.found) {
      showLocateFailure(target);
      return;
    }

    // Bring the highlighted passage into view, then close the popup, it
    // otherwise sits on top of exactly what the user just asked to see;
    // Chrome popups close on losing focus anyway, this just makes that
    // happen immediately instead of requiring a separate click to dismiss.
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tab.id, { active: true });
    window.close();
  } catch (err) {
    console.error("Highlight-in-page failed:", err);
    showLocateFailure(target);
  } finally {
    target.classList.remove("apogee-locating");
  }
}

// Makes each rendered summary bullet/paragraph reachable by keyboard, since
// the click-to-highlight affordance is otherwise mouse-only. Called after
// every summaryText render that produces final content (stream completion,
// cached restore); mid-stream re-renders are skipped, focus wouldn't survive
// the constant innerHTML replacement anyway.
function makeSummaryPassagesFocusable() {
  if (!HIGHLIGHT_SUPPORTED) return;
  summaryText?.querySelectorAll("li, p").forEach((el) => {
    el.setAttribute("tabindex", "0");
    el.setAttribute("title", "Locate this passage on the page");
  });
}

// Links (e.g. YouTube timestamps) navigate the page being summarized in its
// own tab rather than spawning a new one. Registered unconditionally, and
// before the highlight handler below, so a link click is fully consumed here
// (stopImmediatePropagation) and never also triggers passage highlighting.
// This must stay outside the HIGHLIGHT_SUPPORTED gate since Firefox drops that
// block but still needs same-tab link behavior.
summaryText?.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || !summaryText.contains(link)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const tabId = activeTabId;
  if (tabId != null) {
    chrome.tabs.update(tabId, { url: link.href, active: true });
    window.close();
  } else {
    chrome.tabs.create({ url: link.href });
  }
});

if (HIGHLIGHT_SUPPORTED) {
  summaryText?.classList.add("apogee-groundable");
  summaryText?.addEventListener("click", (event) => {
    const target = event.target.closest("li, p");
    if (!target || !summaryText.contains(target)) return;
    locateAndHighlight(target);
  });
  // Keyboard counterpart of the click handler above, for the tabindexed
  // passages makeSummaryPassagesFocusable creates.
  summaryText?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("li, p");
    if (!target || !summaryText.contains(target)) return;
    event.preventDefault();
    locateAndHighlight(target);
  });
}

// Signal popup lifecycle to the service worker to handle offscreen document cleanup
chrome.runtime.connect({ name: "popup-lifecycle" });

async function updateDebugLogsUI() {
  if (!debugLogsCard || debugLogsCard.classList.contains("hidden")) return;
  try {
    const res = await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "get-offscreen-logs",
    });
    if (res && Array.isArray(res.logs)) {
      debugLogsContent.textContent =
        res.logs.join("\n") ||
        "No logs recorded. Try starting summary or chat.";
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
    toggleDebugLogsBtn.querySelector(".logs-toggle-label") ||
    toggleDebugLogsBtn;
  const isHidden = debugLogsCard.classList.contains("hidden");
  if (isHidden) {
    debugLogsCard.classList.remove("hidden");
    label.textContent = "Hide logs";
    toggleDebugLogsBtn.setAttribute("aria-expanded", "true");
    // Emission is gated on this setting (see lib/util/log.js): turning the
    // panel on is what makes the engine hosts start writing progress lines,
    // so the logs cover the next job rather than every job the user runs.
    await saveSettings({ debugLogs: true });
    syncDebugLogsRadios(true);
    await updateDebugLogsUI();
  } else {
    debugLogsCard.classList.add("hidden");
    label.textContent = "Show logs";
    toggleDebugLogsBtn.setAttribute("aria-expanded", "false");
    await saveSettings({ debugLogs: false });
    syncDebugLogsRadios(false);
  }
});

clearDebugLogsBtn?.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "clear-offscreen-logs",
    });
    debugLogsContent.textContent =
      "No logs recorded. Try starting summary or chat.";
  } catch (err) {
    debugLogsContent.textContent = `Error clearing logs: ${err.message}`;
  }
});
