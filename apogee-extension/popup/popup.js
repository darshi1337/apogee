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
  PRIVATE_HOSTS_MAX_CHARS,
  isVideoType,
} from "../lib/constants.js";
import { getSettings } from "../lib/storage/settings.js";
import { formatSummaryAsMarkdown } from "../lib/util/exportFormat.js";
import {
  formatDiagnosticSettings,
  formatDiagnosticsMarkdown,
} from "../lib/util/diagnostics.js";
import { errorHelpUrl, ERROR_HELP_LABEL } from "../lib/util/errorHelp.js";
import { toUserMessage } from "../lib/util/userError.js";
import {
  formatTimeSaved,
  formatVideoTimeSaved,
  timeSavedInputsFor,
  formatTimeSavedFromInputs,
} from "../lib/util/readingTime.js";
import {
  saveViewState,
  loadViewState,
  clearAllViewStates,
  isViewStateKey,
} from "../lib/storage/viewState.js";
import {
  hashUrl,
  getSummaryCacheKey,
  getPromptsCacheKey,
  persistContent,
  getCachedContent,
  shouldPersist,
  clearCachedPages,
  isCachedPageKey,
  CACHEABLE_PAGE_TYPES,
} from "../lib/storage/pageCache.js";
import { searchPastSummaries } from "../lib/retrieval/pastSummariesSearch.js";
import {
  extractFromActiveTab,
  extractPdfContent,
} from "../lib/extract/pageExtraction.js";
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
const pastSummariesFilter = document.getElementById("pastSummariesFilter");
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
const privateHostsInput = document.getElementById("privateHostsInput");
const privateHostsCount = document.getElementById("privateHostsCount");
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
const copyDiagnosticsBtn = document.getElementById("copyDiagnosticsBtn");
const copyDiagnosticsHint = document.getElementById("copyDiagnosticsHint");
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
const historyWipeConfirm = document.getElementById("historyWipeConfirm");
const historyWipeText = document.getElementById("historyWipeText");
const historyWipeCancelBtn = document.getElementById("historyWipeCancelBtn");
const historyWipeDeleteBtn = document.getElementById("historyWipeDeleteBtn");
const versionText = document.getElementById("versionText");

if (versionText) {
  versionText.textContent = `v${chrome.runtime.getManifest().version}`;
}

let currentPageData = null;
let currentSummaryText = "";
let currentSummaryLanguage = null;
let currentTranslationEngine = null;

const LANGUAGE_LABELS = new Map(
  SUMMARY_LANGUAGES.map((l) => [l.code, l.label]),
);

async function updateResummarizeHint(settings) {
  if (!resummarizeHint) return;
  const s = settings || (await getSettings());
  const target = s.summaryLanguage;
  const languageStale =
    !!currentSummaryText.trim() &&
    currentSummaryLanguage != null &&
    currentSummaryLanguage !== target;
  const engineStale =
    !!currentSummaryText.trim() &&
    currentTranslationEngine != null &&
    currentTranslationEngine !== s.translationEngine;
  if (!languageStale && !engineStale) {
    resummarizeHint.classList.add("hidden");
    return;
  }
  if (languageStale && engineStale) {
    resummarizeHintText.textContent =
      "The summary language and translation engine changed. Re-summarize to apply.";
  } else if (engineStale) {
    resummarizeHintText.textContent =
      "This summary used a different translation engine. Re-summarize to apply.";
  } else {
    resummarizeHintText.textContent =
      target === "auto"
        ? "This summary isn't in the page's original language. Re-summarize to apply."
        : `This summary isn't in ${LANGUAGE_LABELS.get(target) || target}. Re-summarize to apply.`;
  }
  resummarizeHint.classList.remove("hidden");
}

resummarizeHintBtn?.addEventListener("click", () => {
  resummarizeHint?.classList.add("hidden");
  summarizeActivePage();
});
let currentAnswerText = "";
let activeSummarizeStreamId = null;
let activeAskStreamId = null;
let settingsEntryView = "homeView";

let activeTabId = null;

let currentPromptsCacheKey = null;

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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !currentPromptsCacheKey) return;
  const change = changes[currentPromptsCacheKey];
  if (!change) return;
  const questions = Array.isArray(change.newValue) ? change.newValue : [];
  setSuggestedQuestions(questions);
});

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

let _webgpuSupported = null;

async function checkWebGPUSupport() {
  if (_webgpuSupported !== null) return _webgpuSupported;
  try {
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
      await saveSettings({ webllmModel: r.value });
    });
  });
}

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

  if (privateHostsInput) {
    privateHostsInput.value = settings.privateHosts || "";
    updatePrivateHostsCount();
  }

  if (summaryLanguageSelect) {
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
  hideHistoryWipeConfirm();

  const sponsorBlockRadio = document.querySelector(
    `input[name="useSponsorBlock"][value="${settings.useSponsorBlock === false ? "off" : "on"}"]`,
  );
  if (sponsorBlockRadio) sponsorBlockRadio.checked = true;

  const debugLogsRadio = document.querySelector(
    `input[name="debugLogs"][value="${settings.debugLogs === true ? "on" : "off"}"]`,
  );
  if (debugLogsRadio) debugLogsRadio.checked = true;

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

const EXTRACTOR_INFO = {
  youtube: { label: "YouTube", icon: "youtube" },
  bilibili: { label: "Bilibili", icon: "bilibili" },
  gmail: { label: "Gmail", icon: "mail" },
  hackernews: { label: "Hacker News", icon: "hacker-news" },
  reddit: { label: "Reddit", icon: "reddit" },
  github: { label: "GitHub", icon: "github" },
  wikipedia: { label: "Wikipedia", icon: "wikipedia" },
  lobsters: { label: "Lobste.rs", icon: "globe" },
  pdf: { label: "PDF", icon: "filetext" },
};

export function updateExtractorChip(pageData) {
  const type = pageData?.isPdf ? "pdf" : pageData?.type;
  const info = EXTRACTOR_INFO[type];
  const chips = [
    {
      chip: document.getElementById("homeExtractorChip"),
      iconEl: document.getElementById("homeExtractorIcon"),
      labelEl: document.getElementById("homeExtractorLabel"),
    },
    {
      chip: document.getElementById("summaryExtractorChip"),
      iconEl: document.getElementById("summaryExtractorIcon"),
      labelEl: document.getElementById("summaryExtractorLabel"),
    },
  ];

  for (const { chip, iconEl, labelEl } of chips) {
    if (!chip) continue;
    if (info) {
      if (iconEl) iconEl.innerHTML = ICONS[info.icon] || "";
      if (labelEl) labelEl.textContent = info.label;
      chip.classList.remove("hidden");
    } else {
      chip.classList.add("hidden");
    }
  }
}

async function getPageData(tab) {
  if (
    currentPageData &&
    currentPageData.url === tab.url &&
    (CACHEABLE_PAGE_TYPES.has(currentPageData.type) ||
      (currentPageData.isPdf && currentPageData.content))
  ) {
    updateExtractorChip(currentPageData);
    return currentPageData;
  }

  const cached = await getCachedContent(tab.url);
  if (cached && CACHEABLE_PAGE_TYPES.has(cached.type)) {
    currentPageData = cached;
    updateExtractorChip(cached);
    return cached;
  }

  const pageData = await extractFromActiveTab(tab);
  if (pageData?.isPdf) {
    pageData.content = await extractPdfContent(tab);
  }
  if (pageData) {
    currentPageData = pageData;
    updateExtractorChip(pageData);
    if (
      CACHEABLE_PAGE_TYPES.has(pageData.type) &&
      (await shouldPersist(tab.url))
    ) {
      await persistContent(tab.url, pageData);
    }
  } else {
    updateExtractorChip(null);
  }
  return pageData;
}

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
      debugLogsContent.textContent = debugLogsContent.textContent.replace(
        /\n?No logs recorded\. Try starting summary or chat\.$/,
        "",
      );
      debugLogsContent.textContent +=
        (debugLogsContent.textContent ? "\n" : "") + message.log;
      if (isScrollAtBottom) {
        debugLogsCard.scrollTop = debugLogsCard.scrollHeight;
      }
    }
  }
});

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
  const spinner = document.createElement("span");
  spinner.className = "apogee-spinner ico";
  spinner.innerHTML = ICONS.sparkle;
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

const LINK_PLACEHOLDER_MARK = "\uE000";

const ALWAYS_LINKIFY_HOSTS = new Set(["youtube.com", "bilibili.com"]);

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

function renderStoredSummaryMarkdown(text) {
  const savedHost = linkifyPageHost;
  linkifyPageHost = null;
  try {
    return renderMarkdown(text);
  } finally {
    linkifyPageHost = savedHost;
  }
}

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

const PAST_SUMMARIES_SHOWN = 8;

function firstLineOf(text) {
  const lines = (text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const line =
    lines.find((l) => !/^#{1,6}\s+/.test(l.trim())) || lines[0] || "";
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "");
}

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
    if (!text) continue;

    const card = document.createElement("div");
    card.className = "past-summary-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.dataset.title = (entry.t || "").toLowerCase();
    card.dataset.cacheKey = entry.s;
    card.setAttribute("aria-expanded", "false");

    const textWrap = document.createElement("div");
    textWrap.className = "past-summary-text";

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
      e.stopPropagation();
      copyToClipboard(text, copyBtn);
    });

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

  const hasCards = pastSummariesList.children.length > 0;
  pastSummariesSection.classList.toggle("hidden", !hasCards);

  if (pastSummariesFilter) {
    pastSummariesFilter.value = "";
    pastSummariesFilter.classList.toggle("hidden", !hasCards);
  }
}

async function filterPastSummaries(query) {
  const q = (query || "").trim();
  const { cacheOrder = [] } = await chrome.storage.local.get("cacheOrder");
  const recent = cacheOrder.slice(-PAST_SUMMARIES_SHOWN).reverse();
  const stored = await chrome.storage.local.get(recent.map((e) => e.s));

  const searchResults = await searchPastSummaries({
    query: q,
    cacheOrder: recent,
    storedSummaries: stored,
  });

  const matchingKeys = new Set(searchResults.map((e) => e.s));

  const cards = pastSummariesList.querySelectorAll(".past-summary-card");
  let visibleCount = 0;
  cards.forEach((card) => {
    const key = card.dataset.cacheKey;
    const match = !q || matchingKeys.has(key);
    card.classList.toggle("hidden", !match);
    if (match) visibleCount++;
  });

  if (q && searchResults.length > 0) {
    const cardMap = new Map();
    cards.forEach((card) => {
      if (card.dataset.cacheKey) cardMap.set(card.dataset.cacheKey, card);
    });
    searchResults.forEach((item) => {
      const card = cardMap.get(item.s);
      if (card) pastSummariesList.appendChild(card);
    });
  }

  const existing = pastSummariesList.querySelector(".past-summaries-empty");
  if (visibleCount === 0 && q && cards.length > 0) {
    if (!existing) {
      const msg = document.createElement("div");
      msg.className = "past-summaries-empty";
      msg.textContent = "No matching summaries.";
      pastSummariesList.appendChild(msg);
    }
  } else if (existing) {
    existing.remove();
  }
}

if (pastSummariesFilter) {
  let filterTimeout = null;
  pastSummariesFilter.addEventListener("input", () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      filterPastSummaries(pastSummariesFilter.value).catch((err) =>
        console.error("Past summaries filter error:", err),
      );
    }, 150);
  });
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

function setTimeSavedBadgeLabel(label) {
  if (!timeSavedBadge) return;
  timeSavedBadge.textContent = label || "";
  timeSavedBadge.classList.toggle("hidden", !label);
}

function updateTimeSavedBadge(pageData, summaryText) {
  const label = isVideoType(pageData?.type)
    ? formatVideoTimeSaved(pageData.durationSeconds, summaryText)
    : formatTimeSaved(pageData?.content, summaryText);
  setTimeSavedBadgeLabel(label);
}

function showTimeSavedFromInputs(inputs, summaryText) {
  setTimeSavedBadgeLabel(formatTimeSavedFromInputs(inputs, summaryText));
}

function setSummaryCopyButtonsVisible(hasText) {
  copySummaryBtn.classList.toggle("hidden", !hasText);
  copyMarkdownBtn?.classList.toggle("hidden", !hasText);
  resummarizeBtn?.classList.toggle("hidden", !hasText);
}

async function copyToClipboard(text, btn) {
  if (!text || !btn) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
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
  modelProgress?.classList.add("hidden");
}

function helpLink(message) {
  const link = document.createElement("a");
  link.className = "error-help-link";
  link.href = errorHelpUrl(message);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = ERROR_HELP_LABEL;
  return link;
}

// Every failure the user can see goes through here, so each one gets the alert
// role, the error styling, and a link into ERROR.md.
function renderError(target, message) {
  const p = document.createElement("p");
  p.setAttribute("role", "alert");
  p.className = "error-message";
  p.textContent = message;
  p.appendChild(helpLink(message));

  target.textContent = "";
  target.appendChild(p);
}

// Same link, for the one-line status spans in Settings that have no room for a
// paragraph.
function renderStatusError(target, message) {
  if (!target) return;
  target.setAttribute("role", "alert");
  target.textContent = `${message} `;
  target.appendChild(helpLink(message));
}

function renderSummaryError(error) {
  console.error(error);
  renderError(summaryText, toUserMessage(error));
}

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
  modelProgress?.classList.add("hidden");
}

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

async function consumeSummaryStream(stream, { tab, promptsCacheKey }) {
  const text = await streamGeneratorIntoElement(stream, summaryText);

  currentSummaryText = text;
  makeSummaryPassagesFocusable();
  showSummaryContext();
  setSummaryCopyButtonsVisible(!!text.trim());
  updateResummarizeHint();
  updateTimeSavedBadge(currentPageData, text);
  await saveViewState(tab.id, {
    view: "summaryView",
    subview: "summary",
    url: tab.url,
    streamId: null,
    timeSaved: timeSavedInputsFor({
      type: currentPageData?.type,
      durationSeconds: currentPageData?.durationSeconds,
      content: currentPageData?.content,
    }),
    summaryLanguage: currentSummaryLanguage,
    translationEngine: currentTranslationEngine,
  });
  setSuggestedQuestionsLoading();

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
    currentSummaryLanguage = settings.summaryLanguage;
    currentTranslationEngine = settings.translationEngine;
    const pageData = await extractFromActiveTab(tab);

    if (!pageData) {
      renderError(
        summaryText,
        "Couldn't read this page, try reloading it, or pick a different tab.",
      );
      return;
    }
    if (!pageData.isPdf && !pageData.content) {
      renderError(
        summaryText,
        "Nothing to summarize here yet, open a page, email, or video first.",
      );
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
      settings.customInstructions,
      settings.translationEngine,
    );
    const promptsCacheKey = await getPromptsCacheKey(
      tab.url,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
      settings.customInstructions,
      settings.translationEngine,
    );
    const finalize = {
      cacheKey,
      promptsCacheKey,
      persist: await shouldPersist(tab.url),
      persistUrl: tab.url,
      providerType: getProviderType(settings),
      host: settings.ollamaHost,
      notifyOnFinish: false,
      language: settings.summaryLanguage,
      translationEngine: settings.translationEngine,
    };

    let streamId, stream;

    if (pageData.isPdf) {
      setLoadingIndicator(summaryText, "Extracting PDF");
      let pdfContent;
      try {
        pdfContent = await extractPdfContent(tab);
      } catch (err) {
        const msg = err?.message || String(err);
        if (msg.startsWith("PDF_TOO_LARGE:")) {
          renderError(
            summaryText,
            "This PDF is too large to process inside the extension. Try a shorter document.",
          );
          return;
        }
        throw err;
      }
      if (!pdfContent) {
        renderError(
          summaryText,
          "Couldn't pull any text out of this PDF, it might be a scanned image.",
        );
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
      summaryLanguage: settings.summaryLanguage,
      translationEngine: settings.translationEngine,
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

const EMPTY_ANSWER_MESSAGE =
  "No answer came back - try rephrasing the question.";

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
  else renderError(answerBox, EMPTY_ANSWER_MESSAGE);

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
    let pageData = await getPageData(tab);
    if (!pageData) {
      renderError(
        answerBox,
        "Couldn't read this page, try reloading it, or pick a different tab.",
      );
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
      renderError(answerBox, toUserMessage(error));
    }
  } finally {
    hideCancelAskButton();
  }
}

async function checkConnection() {
  const settings = await getSettings();
  const provider = getProvider(settings);
  return await provider.checkReady();
}

function updateLocalModelList(settings, status) {
  if (settings.provider !== PROVIDERS.LOCAL) return;

  const liveModels = Array.isArray(status?.models) ? status.models : [];
  if (liveModels.length > 0) {
    const names = liveModels.includes(settings.localModel)
      ? liveModels
      : [settings.localModel, ...liveModels];
    buildLocalModelUI(
      settings.localModel,
      names.map((name) => ({ id: name, label: name })),
    );
    if (localModelStatus) {
      localModelStatus.removeAttribute("role");
      localModelStatus.textContent =
        `${liveModels.length} model${liveModels.length === 1 ? "" : "s"} ` +
        "found on this Ollama instance.";
    }
  } else {
    buildLocalModelUI(settings.localModel, LOCAL_MODELS);
    if (localModelStatus) {
      renderStatusError(
        localModelStatus,
        status?.error
          ? status.error
          : status?.ready
            ? "No models found on this Ollama instance, pull one with `ollama pull <model>`."
            : "Showing default models, connect to Ollama to see yours.",
      );
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

  const target = document.getElementById(view);
  target?.focus({ preventScroll: true });
}

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
    summarizeShortcutHint.classList.add("hidden");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (process.env.TARGET_BROWSER === "firefox") {
    webllmProviderOption?.classList.add("hidden");
  }

  try {
    loadPastSummaries().catch((err) => console.error(err));
    updateSummarizeShortcutHint().catch((err) => console.error(err));

    const settings = await getSettings();
    await applySettingsToUI(settings);

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
    setLinkifyOriginFromUrl(tab.url);

    const state = await loadViewState(tab.id);

    if (state && state.urlHash === (await hashUrl(tab.url)) && state.streamId) {
      currentSummaryLanguage =
        state.summaryLanguage ?? settings.summaryLanguage;
      currentTranslationEngine =
        state.translationEngine ?? settings.translationEngine;
      if (state.subview === "summarizing") {
        showOnlyView("summaryView");
        showSummarizingContext();
        setLoadingIndicator(summaryText, randomSummarizeVerb());
        showCancelSummarizeButton(state.streamId);
        try {
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
            renderError(answerBox, toUserMessage(error));
            await saveViewState(tab.id, { streamId: null });
          }
        } finally {
          hideCancelAskButton();
        }
        return;
      }
    }

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
            renderError(answerBox, EMPTY_ANSWER_MESSAGE);
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
          currentSummaryText = state.summaryText;
          currentSummaryLanguage =
            state.summaryLanguage ?? settings.summaryLanguage;
          currentTranslationEngine =
            state.translationEngine ?? settings.translationEngine;
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
              false,
            );
          }
          return;
        }
      }
    }

    const model = getModelForSettings(settings);
    const cacheKey = await getSummaryCacheKey(
      tab.url,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
      settings.customInstructions,
      settings.translationEngine,
    );
    const promptsCacheKey = await getPromptsCacheKey(
      tab.url,
      settings.responseFormat,
      model,
      settings.summaryLanguage,
      settings.customInstructions,
      settings.translationEngine,
    );
    const cached = await chrome.storage.local.get([cacheKey, promptsCacheKey]);

    if (cached[cacheKey]) {
      currentSummaryText = cached[cacheKey];
      currentSummaryLanguage = settings.summaryLanguage;
      currentTranslationEngine = settings.translationEngine;
      summaryText.innerHTML = renderMarkdown(cached[cacheKey]);
      makeSummaryPassagesFocusable();
      setSummaryCopyButtonsVisible(!!cached[cacheKey].trim());
      updateResummarizeHint(settings);
      const badgeInputs =
        state && state.urlHash === (await hashUrl(tab.url))
          ? state.timeSaved
          : null;
      showTimeSavedFromInputs(badgeInputs, cached[cacheKey]);
      showOnlyView("summaryView");
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

providerRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    // Persist the currently-selected model for the outgoing provider so
    // switching back later restores it (issue #26).
    const prev = await getSettings();
    const modelPatch = {};
    if (prev.provider === PROVIDERS.WEBLLM) {
      const sel = webllmModelList.querySelector(
        'input[name="webllmModel"]:checked',
      );
      if (sel) modelPatch.webllmModel = sel.value;
    } else if (prev.provider === PROVIDERS.TRANSFORMERS) {
      const sel = transformersModelList.querySelector(
        'input[name="transformersModel"]:checked',
      );
      if (sel) modelPatch.transformersModel = sel.value;
    } else if (prev.provider === PROVIDERS.LOCAL) {
      const sel = localModelList.querySelector(
        'input[name="localModel"]:checked',
      );
      if (sel) modelPatch.localModel = sel.value;
    }
    const settings = await saveSettings({
      ...modelPatch,
      provider: radio.value,
    });
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

function updateCustomInstructionsCount() {
  if (!customInstructionsCount || !customInstructionsInput) return;
  const len = customInstructionsInput.value.length;
  customInstructionsCount.textContent = `${len} / ${CUSTOM_INSTRUCTIONS_MAX_CHARS}`;
}

if (customInstructionsInput) {
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

function updatePrivateHostsCount() {
  if (!privateHostsCount || !privateHostsInput) return;
  const len = privateHostsInput.value.length;
  privateHostsCount.textContent = `${len} / ${PRIVATE_HOSTS_MAX_CHARS}`;
}

if (privateHostsInput) {
  let privateHostsSaveTimer = null;
  const persistPrivateHosts = async () => {
    const value = privateHostsInput.value
      .slice(0, PRIVATE_HOSTS_MAX_CHARS)
      .trim();
    await saveSettings({ privateHosts: value });
  };

  privateHostsInput.addEventListener("input", () => {
    updatePrivateHostsCount();
    clearTimeout(privateHostsSaveTimer);
    privateHostsSaveTimer = setTimeout(persistPrivateHosts, 500);
  });
  privateHostsInput.addEventListener("blur", () => {
    clearTimeout(privateHostsSaveTimer);
    persistPrivateHosts();
  });
}

summaryLanguageSelect?.addEventListener("change", async () => {
  const settings = await saveSettings({
    summaryLanguage: summaryLanguageSelect.value,
  });
  await updateResummarizeHint(settings);
});

translationEngineRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const settings = await saveSettings({ translationEngine: radio.value });
    await updateResummarizeHint(settings);
  });
});

themeRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const settings = await saveSettings({ theme: radio.value });
    applyTheme(settings.theme);
  });
});

function hideHistoryWipeConfirm() {
  historyWipeConfirm?.classList.add("hidden");
}

function showHistoryWipeConfirm(summaryCount) {
  if (!historyWipeConfirm) return;
  const what =
    summaryCount === 1
      ? "the 1 summary"
      : summaryCount > 0
        ? `the ${summaryCount} summaries`
        : "the page data";
  const message = `This also deletes ${what} already saved on this device. Your settings are kept. There's no undo.`;
  if (historyWipeText) historyWipeText.textContent = message;
  historyWipeConfirm.classList.remove("hidden");
  // Focus stays on the radio the user is still arrowing through. Pulling it
  // onto a delete button would put a destructive action one stray Space away.
  announce(message);
}

function checkSaveHistoryRadio(on) {
  saveHistoryRadios.forEach((radio) => {
    radio.checked = radio.value === (on ? "on" : "off");
  });
}

saveHistoryRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    if (radio.value === "on") {
      hideHistoryWipeConfirm();
      await saveSettings({ saveHistory: true });
      return;
    }
    // Turning history off deletes what is already saved, which is the whole
    // point of the toggle and also not undoable. Nothing is written or removed
    // until the second, deliberate click.
    const stored = await storedHistoryStats();
    if (!stored.any) {
      await saveSettings({ saveHistory: false });
      return;
    }
    showHistoryWipeConfirm(stored.summaries);
  });
});

historyWipeCancelBtn?.addEventListener("click", async () => {
  hideHistoryWipeConfirm();
  const settings = await getSettings();
  checkSaveHistoryRadio(settings.saveHistory !== false);
});

historyWipeDeleteBtn?.addEventListener("click", async () => {
  historyWipeDeleteBtn.disabled = true;
  try {
    // The setting goes first: a summary still generating re-checks it when it
    // finishes, so from here on nothing new can land behind the wipe.
    await saveSettings({ saveHistory: false });
    await clearCachedData();
    hideHistoryWipeConfirm();
    if (clearDataStatus) {
      clearDataStatus.removeAttribute("role");
      clearDataStatus.textContent = "History off, saved summaries deleted.";
    }
    announce("History off, saved summaries deleted.");
  } catch (err) {
    renderStatusError(
      clearDataStatus,
      `Error clearing saved history: ${err.message}`,
    );
  } finally {
    historyWipeDeleteBtn.disabled = false;
  }
});

sponsorBlockRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ useSponsorBlock: radio.value === "on" });
  });
});

function syncDebugLogsRadios(on) {
  debugLogsRadios.forEach((radio) => {
    radio.checked = radio.value === (on ? "on" : "off");
  });
  copyDiagnosticsBtn?.classList.toggle("hidden", !on);
  copyDiagnosticsHint?.classList.toggle("hidden", !on);
}

debugLogsRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const on = radio.value === "on";
    await saveSettings({ debugLogs: on });
    copyDiagnosticsBtn?.classList.toggle("hidden", !on);
    copyDiagnosticsHint?.classList.toggle("hidden", !on);
  });
});

// Both halves clear under their own module's lock, so a write landing at the
// same moment can't leave an order index pointing at a deleted key.
async function clearCachedData() {
  const pages = await clearCachedPages();
  const viewStates = await clearAllViewStates();
  currentSummaryText = "";
  currentSummaryLanguage = null;
  currentTranslationEngine = null;
  updateResummarizeHint();
  await loadPastSummaries();
  return pages + viewStates;
}

/** What is on disk right now, for telling the user what a wipe would cost. */
async function storedHistoryStats() {
  const all = await chrome.storage.local.get(null);
  return {
    any: Object.keys(all).some((k) => isCachedPageKey(k) || isViewStateKey(k)),
    summaries: (all.cacheOrder || []).length,
  };
}

clearDataBtn?.addEventListener("click", async () => {
  clearDataBtn.disabled = true;
  try {
    await clearCachedData();
    if (clearDataStatus) {
      clearDataStatus.removeAttribute("role");
      clearDataStatus.textContent = "Cached data cleared.";
    }
  } catch (err) {
    renderStatusError(
      clearDataStatus,
      `Error clearing cached data: ${err.message}`,
    );
  } finally {
    clearDataBtn.disabled = false;
  }
});

backendUrlInput?.addEventListener("change", async () => {
  let val = (backendUrlInput.value || DEFAULT_OLLAMA_HOST).trim();
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

document.querySelectorAll(".brand").forEach((brand) => {
  brand.addEventListener("click", () => {
    showOnlyView("homeView");
    saveViewState(activeTabId, { view: "homeView" });
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
  saveViewState(activeTabId, { view: settingsEntryView });
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

const HIGHLIGHT_SUPPORTED = process.env.TARGET_BROWSER !== "firefox";

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

function makeSummaryPassagesFocusable() {
  if (!HIGHLIGHT_SUPPORTED) return;
  summaryText?.querySelectorAll("li, p").forEach((el) => {
    el.setAttribute("tabindex", "0");
    el.setAttribute("title", "Locate this passage on the page");
  });
}

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
  summaryText?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("li, p");
    if (!target || !summaryText.contains(target)) return;
    event.preventDefault();
    locateAndHighlight(target);
  });
}

chrome.runtime.connect({ name: "popup-lifecycle" });

async function diagnosticHeader() {
  const settings = await getSettings();
  return formatDiagnosticSettings(settings, {
    version: chrome.runtime.getManifest().version,
    browser: navigator.userAgent,
    webgpu: "gpu" in navigator ? "available" : "unavailable",
  });
}

async function updateDebugLogsUI() {
  if (!debugLogsCard || debugLogsCard.classList.contains("hidden")) return;
  try {
    const res = await chrome.runtime.sendMessage({
      target: "service-worker",
      action: "get-offscreen-logs",
    });
    if (res && Array.isArray(res.logs)) {
      const body =
        res.logs.join("\n") ||
        "No logs recorded. Try starting summary or chat.";
      debugLogsContent.removeAttribute("role");
      debugLogsContent.textContent = `${await diagnosticHeader()}\n${body}`;
      debugLogsCard.scrollTop = debugLogsCard.scrollHeight;
    }
  } catch (err) {
    renderStatusError(debugLogsContent, `Error fetching logs: ${err.message}`);
  }
}

toggleDebugLogsBtn?.addEventListener("click", async () => {
  const label =
    toggleDebugLogsBtn.querySelector(".logs-toggle-label") ||
    toggleDebugLogsBtn;
  const isHidden = debugLogsCard.classList.contains("hidden");
  if (isHidden) {
    debugLogsCard.classList.remove("hidden");
    label.textContent = "Hide logs";
    toggleDebugLogsBtn.setAttribute("aria-expanded", "true");
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
    debugLogsContent.removeAttribute("role");
    debugLogsContent.textContent = `${await diagnosticHeader()}\nNo logs recorded. Try starting summary or chat.`;
  } catch (err) {
    renderStatusError(debugLogsContent, `Error clearing logs: ${err.message}`);
  }
});

copyDiagnosticsBtn?.addEventListener("click", async () => {
  const original = copyDiagnosticsBtn.textContent;
  try {
    let logs = [];
    try {
      const res = await chrome.runtime.sendMessage({
        target: "service-worker",
        action: "get-offscreen-logs",
      });
      if (res && Array.isArray(res.logs)) logs = res.logs;
    } catch {
      logs = ["(engine logs unavailable: the service worker did not respond)"];
    }
    const settings = await getSettings();
    await navigator.clipboard.writeText(
      formatDiagnosticsMarkdown(
        settings,
        {
          version: chrome.runtime.getManifest().version,
          browser: navigator.userAgent,
          webgpu: "gpu" in navigator ? "available" : "unavailable",
        },
        logs,
      ),
    );
    copyDiagnosticsBtn.textContent = "Copied";
  } catch {
    copyDiagnosticsBtn.textContent = "Copy failed";
  }
  setTimeout(() => {
    copyDiagnosticsBtn.textContent = original;
  }, 1500);
});
