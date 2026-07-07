import { getProvider } from "../lib/providers.js";
import {
  PROVIDERS,
  DEFAULT_SETTINGS,
  WEBLLM_MODELS,
  DEFAULT_LOCAL_API_BASE,
} from "../lib/constants.js";

// ─── DOM references ──────────────────────────────────────────────────────────

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
const backendUrlInput = document.getElementById("backendUrlInput");
const promptsCloseBtn = document.querySelector(".prompts-toggle");
const togglePromptsBtn = document.getElementById("togglePromptsBtn");
const getInTouchBtn = document.getElementById("getInTouchBtn");
const contactView = document.getElementById("contactView");
const settingsLogo = document.getElementById("settingsLogo");
const contactLogo = document.getElementById("contactLogo");
const webllmModelsCard = document.getElementById("webllmModelsCard");
const localSettingsCard = document.getElementById("localSettingsCard");
const localModelsCard = document.getElementById("localModelsCard");
const webllmModelList = document.getElementById("webllmModelList");
const webgpuWarning = document.getElementById("webgpuWarning");
const modelProgress = document.getElementById("modelProgress");
const modelProgressText = document.getElementById("modelProgressText");
const modelProgressPercent = document.getElementById("modelProgressPercent");
const modelProgressFill = document.getElementById("modelProgressFill");

let currentPageData = null;
let currentSummaryText = "";

// ─── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

async function saveSettings(partial) {
  const settings = { ...(await getSettings()), ...partial };
  await chrome.storage.local.set({ settings });
  return settings;
}

async function clearStoredSummaries() {
  const stored = await chrome.storage.local.get(null);
  const keys = Object.keys(stored).filter(
    (k) => k.startsWith("summary:") || k.startsWith("suggested-prompts:"),
  );
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}

// ─── WebGPU detection ────────────────────────────────────────────────────────
// NOTE: The popup runs in a chrome-extension:// context where navigator.gpu is
// always undefined. The actual WebGPU context lives in the offscreen document.
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
  } catch {
    // If we can't reach the service worker, assume supported and let the
    // offscreen doc surface the real error when inference is attempted.
    _webgpuSupported = true;
  }
  return _webgpuSupported;
}

// ─── Build WebLLM model radio list ───────────────────────────────────────────

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

  // Bind change events
  webllmModelList.querySelectorAll('input[name="webllmModel"]').forEach((r) => {
    r.addEventListener("change", async () => {
      await saveSettings({ webllmModel: r.value });
      await clearStoredSummaries();
    });
  });
}

// ─── Apply settings to UI ────────────────────────────────────────────────────

async function applySettingsToUI(settings) {
  // Provider
  const provRadio = document.querySelector(
    `input[name="provider"][value="${settings.provider}"]`,
  );
  if (provRadio) provRadio.checked = true;

  // Show/hide provider-specific cards
  const isWebllm = settings.provider === PROVIDERS.WEBLLM;
  webllmModelsCard.classList.toggle("hidden", !isWebllm);
  localSettingsCard.classList.toggle("hidden", isWebllm);
  localModelsCard.classList.toggle("hidden", isWebllm);

  // WebLLM models
  buildWebllmModelUI(settings.webllmModel);

  // Local settings
  if (backendUrlInput) backendUrlInput.value = settings.localApiBase;
  const localRadio = document.querySelector(
    `input[name="localModel"][value="${settings.localModel}"]`,
  );
  if (localRadio) localRadio.checked = true;

  // Format
  const fmtRadio = document.querySelector(
    `input[name="format"][value="${settings.responseFormat}"]`,
  );
  if (fmtRadio) fmtRadio.checked = true;

  // WebGPU warning — check via offscreen document, not popup context
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

// ─── Content extraction ──────────────────────────────────────────────────────

async function extractFromActiveTab(tab) {
  const tabId = tab.id;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.documentElement.removeAttribute("data-apogee-result");
      },
    });
  } catch {
    // scripting blocked
  }

  let isAlreadyInjected = false;
  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.extractPageContent === "function",
    });
    isAlreadyInjected = checkResult?.[0]?.result;
  } catch {
    // ignore
  }

  if (isAlreadyInjected) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["/content/run_extraction.js"],
    });
  } else {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "/content/Readability.js",
        "/content/extractors/generic.js",
        "/content/extractors/youtube.js",
        "/content/extractors/gmail.js",
        "/content/content.js",
        "/content/run_extraction.js",
      ],
    });
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const val = document.documentElement.getAttribute("data-apogee-result");
      document.documentElement.removeAttribute("data-apogee-result");
      return val ? JSON.parse(val) : null;
    },
  });

  const pageData = results?.[0]?.result;
  if (pageData?.error) throw new Error(pageData.error);
  return pageData;
}

// ─── Model progress listener ─────────────────────────────────────────────────

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
});

// ─── UI helpers ──────────────────────────────────────────────────────────────

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
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    if (listType) { html += `</${listType}>`; listType = null; }
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") { closeList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { closeList(); html += `<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`; continue; }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
      html += `<li>${renderInline(bullet[1])}</li>`; continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
      html += `<li>${renderInline(ordered[1])}</li>`; continue;
    }
    closeList();
    html += `<p>${renderInline(line)}</p>`;
  }
  closeList();
  return html;
}

function resetQuestionCards() { setSuggestedQuestions([]); }

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

function getSummaryCacheKey(url, fmt) { return `summary:${fmt}:${url}`; }
function getPromptsCacheKey(url, fmt) { return `suggested-prompts:${fmt}:${url}`; }

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

// ─── Streaming into DOM ──────────────────────────────────────────────────────

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

// ─── Core actions ────────────────────────────────────────────────────────────

async function summarizeActivePage() {
  homeView.classList.add("hidden");
  summaryView.classList.remove("hidden");
  showSummarizingContext();
  setLoadingIndicator(summaryText, "Summarizing");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const settings = await getSettings();
    const provider = getProvider(settings);
    const pageData = await extractFromActiveTab(tab);

    if (!pageData) { summaryText.textContent = "Could not extract page."; return; }
    currentPageData = pageData;

    const cacheKey = getSummaryCacheKey(tab.url, settings.responseFormat);
    const promptsCacheKey = getPromptsCacheKey(tab.url, settings.responseFormat);
    let text;

    if (pageData.isPdf) {
      setLoadingIndicator(summaryText, "Summarizing PDF");
      if (settings.provider === PROVIDERS.LOCAL) {
        // Local backend handles PDF download + extraction
        text = await streamGeneratorIntoElement(
          provider.summarizePdf({ url: pageData.url, mode: settings.responseFormat }),
          summaryText,
        );
      } else {
        // WebLLM: PDF text extraction not available in-browser without pdf.js
        // Fall back to summarizing whatever content the content script got
        if (!pageData.content) {
          summaryText.innerHTML =
            '<p style="color:#d93025;font-size:13px">' +
            "PDF summarization requires Local Ollama mode. " +
            "Switch to Local Ollama in Settings to summarize PDFs.</p>";
          return;
        }
        text = await streamGeneratorIntoElement(
          provider.summarize({
            title: pageData.title,
            url: pageData.url,
            content: pageData.content,
            mode: settings.responseFormat,
          }),
          summaryText,
        );
      }
    } else {
      text = await streamGeneratorIntoElement(
        provider.summarize({
          title: pageData.title,
          url: pageData.url,
          content: pageData.content,
          mode: settings.responseFormat,
        }),
        summaryText,
      );
    }

    await chrome.storage.local.set({ [cacheKey]: text });
    currentSummaryText = text;
    showSummaryContext();
    setSuggestedQuestionsLoading();

    let suggestedQuestions = [];
    try {
      suggestedQuestions = await provider.suggestQuestions({
        title: pageData.title,
        url: pageData.url,
        summary: text,
      });
    } catch (error) {
      console.error(error);
    }

    await chrome.storage.local.set({ [promptsCacheKey]: suggestedQuestions });
    setSuggestedQuestions(suggestedQuestions);
  } catch (error) {
    console.error(error);
    summaryText.innerHTML =
      '<p style="color:#d93025;font-size:13px">' + escapeHtml(error.message) + "</p>";
  }
}

async function submitQuestion(question) {
  const trimmed = question.trim();
  if (!trimmed) { questionInput.focus(); return; }
  showAnswerContext(trimmed);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageData = await extractFromActiveTab(tab);
    if (!pageData) { answerBox.textContent = "Could not extract page."; return; }
    currentPageData = pageData;

    const settings = await getSettings();
    const provider = getProvider(settings);
    const content = pageData.content || currentSummaryText;
    if (!content) { throw new Error("Could not extract enough page content to answer."); }

    let fullText = "";
    let started = false;
    for await (const chunk of provider.ask({
      title: pageData.title,
      url: pageData.url,
      content,
      question: trimmed,
    })) {
      fullText += chunk;
      if (!started && fullText.trim() === "") continue;
      if (!started) { answerBox.textContent = ""; started = true; }
      answerBox.textContent = fullText.trimStart();
    }
    if (started) answerBox.innerHTML = renderMarkdown(answerBox.textContent);
    else answerBox.textContent = "";
  } catch (error) {
    console.error(error);
    answerBox.textContent = error.message;
  }
}

// ─── Connection status ───────────────────────────────────────────────────────

async function checkConnection() {
  const settings = await getSettings();
  const provider = getProvider(settings);
  const status = await provider.checkReady();
  return status?.ready === true;
}

function updateConnectionUI(connected) {
  const text = connected ? "Connected" : "Disconnected";
  const cls = connected ? "status-dot connected" : "status-dot disconnected";
  for (const id of ["homeStatusText", "settingsStatusText", "summaryStatusText"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  for (const id of ["homeStatusDot", "settingsStatusDot", "summaryStatusDot"]) {
    const el = document.getElementById(id);
    if (el) el.className = cls;
  }
}

// ─── Event listeners ─────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const settings = await getSettings();
    await applySettingsToUI(settings);

    const connected = await checkConnection();
    updateConnectionUI(connected);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const cacheKey = getSummaryCacheKey(tab.url, settings.responseFormat);
    const promptsCacheKey = getPromptsCacheKey(tab.url, settings.responseFormat);
    const cached = await chrome.storage.local.get([cacheKey, promptsCacheKey]);

    if (cached[cacheKey]) {
      currentSummaryText = cached[cacheKey];
      summaryText.innerHTML = renderMarkdown(cached[cacheKey]);
      homeView.classList.add("hidden");
      summaryView.classList.remove("hidden");
      showSummaryContext(cached[promptsCacheKey] || []);
      return;
    }
  } catch (error) {
    console.error(error);
  }
  showSummaryContext();
});

summarizeBtn?.addEventListener("click", () => summarizeActivePage());

settingsBtn?.addEventListener("click", () => {
  homeView.classList.add("hidden");
  settingsView.classList.remove("hidden");
});

settingsBtn2?.addEventListener("click", () => {
  summaryView.classList.add("hidden");
  settingsView.classList.remove("hidden");
});

closeBtn?.addEventListener("click", () => window.close());
closeBtn2?.addEventListener("click", () => window.close());
closeBtn3?.addEventListener("click", () => window.close());
closeBtn4?.addEventListener("click", () => window.close());

document.getElementById("askBtn")?.addEventListener("click", () => {
  homeView.classList.add("hidden");
  summaryView.classList.remove("hidden");
  showAskContext();
  questionInput.focus();
});

sendBtn?.addEventListener("click", () => submitQuestion(questionInput.value));
questionInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitQuestion(questionInput.value); }
});

// Provider radio
providerRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    const settings = await saveSettings({ provider: radio.value });
    await applySettingsToUI(settings);
    await clearStoredSummaries();
    updateConnectionUI(await checkConnection());
  });
});

// Format radio
formatRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ responseFormat: radio.value });
    await clearStoredSummaries();
  });
});

// Local model radio
localModelRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({ localModel: radio.value });
    await clearStoredSummaries();
  });
});

// Backend URL
backendUrlInput?.addEventListener("change", async () => {
  const val = (backendUrlInput.value || DEFAULT_LOCAL_API_BASE).trim().replace(/\/+$/, "");
  const settings = await saveSettings({ localApiBase: val });
  await applySettingsToUI(settings);
  await clearStoredSummaries();
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
  settingsView.classList.add("hidden");
  contactView.classList.remove("hidden");
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

settingsLogo?.addEventListener("click", () => {
  settingsView.classList.add("hidden");
  contactView.classList.add("hidden");
  homeView.classList.remove("hidden");
});

contactLogo?.addEventListener("click", () => {
  contactView.classList.add("hidden");
  homeView.classList.remove("hidden");
});

document.getElementById("questionContainer")?.addEventListener("click", (event) => {
  const card = event.target.closest(".prompt-card");
  if (!card || card.disabled) return;
  submitQuestion(card.textContent);
});
