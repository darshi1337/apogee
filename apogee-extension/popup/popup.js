// Must match the backend's APOGEE_HOST/APOGEE_PORT (default 127.0.0.1:8000).
const API_BASE = "http://127.0.0.1:8000";

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

const questionHeading = document.getElementById("questionHeading");

const answerHeading = document.getElementById("answerHeading");

const questionInput = document.getElementById("questionInput");

const sendBtn = document.getElementById("sendBtn");

const answerBox = document.getElementById("answerBox");

const promptCards = document.querySelectorAll(".prompt-card");

const formatRadios = document.querySelectorAll('input[name="format"]');

const modelRadios = document.querySelectorAll('input[name="model"]');

const promptsCloseBtn = document.querySelector(".prompts-toggle");

const togglePromptsBtn = document.getElementById("togglePromptsBtn");

const getInTouchBtn = document.getElementById("getInTouchBtn");

const contactView = document.getElementById("contactView");

const settingsLogo = document.getElementById("settingsLogo");

const contactLogo = document.getElementById("contactLogo");

const contentScriptFiles = [
  "content/Readability.js",
  "content/extractors/generic.js",
  "content/extractors/youtube.js",
  "content/content.js",
];

const defaultQuestions = Array.from(promptCards, (card) =>
  card.textContent.trim(),
);

const defaultSettings = {
  responseFormat: "bullets",
  model: "qwen3:8b",
};

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");

  return {
    ...defaultSettings,
    ...(stored.settings || {}),
  };
}

function applySettingsToUI(settings) {
  const formatRadio = document.querySelector(
    `input[name="format"][value="${settings.responseFormat}"]`,
  );

  const modelRadio = document.querySelector(
    `input[name="model"][value="${settings.model}"]`,
  );

  formatRadio && (formatRadio.checked = true);
  modelRadio && (modelRadio.checked = true);
}

async function saveSettings(partialSettings) {
  const settings = {
    ...(await getSettings()),
    ...partialSettings,
  };

  await chrome.storage.local.set({
    settings,
  });

  return settings;
}

async function clearStoredSummaries() {
  const stored = await chrome.storage.local.get(null);
  const summaryKeys = Object.keys(stored).filter((key) =>
    key.startsWith("summary:"),
  );

  if (summaryKeys.length > 0) {
    await chrome.storage.local.remove(summaryKeys);
  }
}

function resetQuestionCards() {
  questionHeading.textContent = "Suggested Prompts";

  promptsCloseBtn.classList.remove("hidden");

  const container = document.getElementById("questionContainer");
  container.innerHTML = "";

  const prompts = [
    "Explain this like I'm five.",
    "Give me the key takeaways.",
  ];

  prompts.forEach((text) => {
    const btn = document.createElement("button");
    btn.className = "prompt-card";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      submitQuestion(btn.textContent);
    });
    container.appendChild(btn);
  });
}

function getSummaryCacheKey(url, responseFormat) {
  return `summary:${responseFormat}:${url}`;
}

function showSummaryContext() {
  summaryCard.classList.remove("hidden");
  promptsSection.classList.remove("hidden");
  questionHeading.textContent = "Suggested Prompts";
  answerHeading.textContent = "Answer";
  resetQuestionCards();
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
  answerHeading.textContent = "Answer";
  resetQuestionCards();
  promptsCloseBtn.classList.add("hidden");
  questionInput.classList.remove("hidden");
  sendBtn.classList.remove("hidden");
  answerBox.classList.add("hidden");
  questionInput.value = "";
  answerBox.textContent = "";
  togglePromptsBtn.style.display = "none";
}

function showQuestion(question) {
  questionHeading.textContent = "Question";
  promptsCloseBtn.classList.add("hidden");

  const container = document.getElementById("questionContainer");
  container.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "prompt-card";
  btn.disabled = true;
  btn.textContent = question;
  container.appendChild(btn);
}

function showAnswerContext(question) {
  showQuestion(question);
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

function sendExtractMessage(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: "extract" }, (pageData) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(pageData);
    });
  });
}

async function injectContentScripts(tabId) {
  for (const file of contentScriptFiles) {
    await new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        {
          target: {
            tabId,
          },
          files: [file],
        },
        () => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(new Error(error.message));
            return;
          }

          resolve();
        },
      );
    });
  }
}

async function extractFromActiveTab(tab) {
  // Content scripts are injected on demand (activeTab), not on every page.
  // The first extraction in a tab has no listener yet, so we inject then
  // retry. Subsequent extractions in the same tab reuse the injected script.
  try {
    return await sendExtractMessage(tab.id);
  } catch (error) {
    console.debug("Injecting content scripts on demand:", error.message);

    await injectContentScripts(tab.id);

    return sendExtractMessage(tab.id);
  }
}

function setLoadingIndicator(element, label) {
  const wrapper = document.createElement("span");
  wrapper.className = "apogee-loading";

  const spinner = document.createElement("span");
  spinner.className = "apogee-spinner";

  const text = document.createElement("span");
  text.textContent = label; // safe: textContent, never innerHTML

  const dots = document.createElement("span");
  dots.className = "apogee-dots";

  text.appendChild(dots);
  wrapper.appendChild(spinner);
  wrapper.appendChild(text);

  element.textContent = ""; // clear existing content
  element.appendChild(wrapper);
}

// Minimal Markdown renderer. Input is HTML-escaped first, then only a fixed
// set of formatting tags is emitted — no attributes, links, or raw HTML — so
// untrusted model/page output can't inject markup.
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      const level = heading[1].length;
      html += `<h${level}>${renderInline(heading[2])}</h${level}>`;
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

async function streamIntoElement(response, element) {
  if (!response.body) {
    const text = await response.text();
    element.innerHTML = renderMarkdown(text.trimStart());
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  // Hold the loading indicator until the first non-whitespace token.
  let started = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
    const visible = fullText.trimStart();
    if (!started && visible === "") continue;
    started = true;
    element.innerHTML = renderMarkdown(visible);
  }

  fullText += decoder.decode();
  element.innerHTML = renderMarkdown(fullText.trimStart());
  return fullText;
}

async function fetchSummaryStream(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `Request failed: ${response.status}`);
  }

  return response;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function appendTextByWord(element, text, speed = 45) {
  const words = text.split(/(\s+)/);

  for (const word of words) {
    element.textContent += word;
    await wait(speed);
  }
}

async function streamAnswer(pageData, question, element) {
  const settings = await getSettings();
  const response = await fetch(`${API_BASE}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: pageData.title,
      url: pageData.url,
      content: pageData.content,
      question,
      model: settings.model,
    }),
  });

  if (!response.ok) {
    const answer = await response.text();
    throw new Error(answer || `Ask request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendingText = "";
  // Hold the loading indicator until the first word, then start typing.
  let started = false;

  const beginIfNeeded = () => {
    if (!started) {
      element.textContent = "";
      started = true;
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    pendingText += decoder.decode(value, { stream: true });
    const completeWords = pendingText.match(/\S+\s+/g) || [];

    if (completeWords.length > 0) {
      const typedText = completeWords.join("");
      pendingText = pendingText.slice(typedText.length);
      beginIfNeeded();
      await appendTextByWord(element, typedText);
    }
  }

  pendingText += decoder.decode();

  if (pendingText) {
    beginIfNeeded();
    await appendTextByWord(element, pendingText);
  }

  if (started) {
    element.innerHTML = renderMarkdown(element.textContent);
  } else {
    element.textContent = "";
  }
}

async function submitQuestion(question) {
  const trimmedQuestion = question.trim();

  if (!trimmedQuestion) {
    questionInput.focus();
    return;
  }

  showAnswerContext(trimmedQuestion);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const pageData = await extractFromActiveTab(tab);

    if (!pageData) {
      answerBox.textContent = "Could not extract page.";
      return;
    }

    await streamAnswer(pageData, trimmedQuestion, answerBox);
  } catch (error) {
    console.error(error);

    answerBox.textContent = error.message;
  }
}

async function summarizeActivePage() {
  homeView.classList.add("hidden");
  summaryView.classList.remove("hidden");
  showSummaryContext();
  setLoadingIndicator(summaryText, "Summarizing");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const settings = await getSettings();

    // Try to extract page content first; use the content script's
    // authoritative isPdf flag instead of guessing from the URL.
    const pageData = await extractFromActiveTab(tab);

    if (!pageData) {
      summaryText.textContent = "Could not extract page.";
      return;
    }

    const cacheKey = getSummaryCacheKey(tab.url, settings.responseFormat);
    let text;

    if (pageData.isPdf) {
      setLoadingIndicator(summaryText, "Summarizing PDF");

      const response = await fetchSummaryStream(
        `${API_BASE}/pdf/url`,
        {
          url: pageData.url,
          mode: settings.responseFormat,
          model: settings.model,
        },
      );

      text = await streamIntoElement(response, summaryText);
    } else {
      const response = await fetchSummaryStream(
        `${API_BASE}/summarize`,
        {
          title: pageData.title,
          url: pageData.url,
          content: pageData.content,
          mode: settings.responseFormat,
          model: settings.model,
        },
      );

      text = await streamIntoElement(response, summaryText);
    }

    // Cache both PDF and non-PDF summaries
    await chrome.storage.local.set({
      [cacheKey]: text,
    });
  } catch (error) {
    console.error(error);

    summaryText.innerHTML =
      '<p style="color:#d93025;font-size:13px">' +
      escapeHtml(error.message) +
      "</p>";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const settings = await getSettings();
    const connected = await checkOllamaConnection();
    updateConnectionUI(connected);
    applySettingsToUI(settings);

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const cacheKey = getSummaryCacheKey(tab.url, settings.responseFormat);
    const cached = await chrome.storage.local.get(cacheKey);

    if (cached[cacheKey]) {
      summaryText.innerHTML = renderMarkdown(cached[cacheKey]);
      homeView.classList.add("hidden");
      summaryView.classList.remove("hidden");
      showSummaryContext();
      return;
    }
  } catch (error) {
    console.error(error);
  }

  showSummaryContext();
  resetQuestionCards();
});

summarizeBtn?.addEventListener("click", () => {
  summarizeActivePage();
});

settingsBtn?.addEventListener("click", () => {
  homeView.classList.add("hidden");
  settingsView.classList.remove("hidden");
});

settingsBtn2?.addEventListener("click", () => {
  summaryView.classList.add("hidden");
  settingsView.classList.remove("hidden");
});

closeBtn?.addEventListener("click", () => {
  window.close();
});

closeBtn2?.addEventListener("click", () => {
  window.close();
});

closeBtn3?.addEventListener("click", () => {
  window.close();
});

closeBtn4?.addEventListener("click", () => {
  window.close();
});

document.getElementById("askBtn")?.addEventListener("click", () => {
  homeView.classList.add("hidden");
  summaryView.classList.remove("hidden");
  showAskContext();
  questionInput.focus();
});

sendBtn?.addEventListener("click", () => {
  submitQuestion(questionInput.value);
});

questionInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitQuestion(questionInput.value);
  }
});

formatRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({
      responseFormat: radio.value,
    });

    await clearStoredSummaries();
  });
});

modelRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    await saveSettings({
      model: radio.value,
    });

    await clearStoredSummaries();
  });
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
  chrome.tabs.create({
    url: "https://github.com/darshi1337/apogee",
  });
});

document.getElementById("bugBtn")?.addEventListener("click", () => {
  chrome.tabs.create({
    url: "https://github.com/darshi1337/apogee/issues",
  });
});

document.getElementById("featureBtn")?.addEventListener("click", () => {
  chrome.tabs.create({
    url: "https://github.com/darshi1337/apogee/issues",
  });
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

document
  .getElementById("questionContainer")
  ?.addEventListener("click", (event) => {
    const card = event.target.closest(".prompt-card");

    if (!card || card.disabled) {
      return;
    }

    submitQuestion(card.textContent);
  });

async function checkOllamaConnection() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return false;

    const data = await response.json();

    return data.connected;
  } catch {
    return false;
  }
}

function updateConnectionUI(connected) {
  const homeStatusText = document.getElementById("homeStatusText");

  const settingsStatusText = document.getElementById("settingsStatusText");

  const summaryStatusText = document.getElementById("summaryStatusText");

  const homeStatusDot = document.getElementById("homeStatusDot");

  const settingsStatusDot = document.getElementById("settingsStatusDot");

  const summaryStatusDot = document.getElementById("summaryStatusDot");

  const text = connected ? "Connected" : "Disconnected";

  const dotClass = connected
    ? "status-dot connected"
    : "status-dot disconnected";

  homeStatusText.textContent = text;

  settingsStatusText.textContent = text;

  if (summaryStatusText) summaryStatusText.textContent = text;

  homeStatusDot.className = dotClass;

  settingsStatusDot.className = dotClass;

  if (summaryStatusDot) summaryStatusDot.className = dotClass;
}
