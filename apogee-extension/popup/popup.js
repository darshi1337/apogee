console.log("chrome =", typeof chrome);

const summarizeBtn = document.getElementById("summarizeBtn");

const summaryText = document.getElementById("summaryText");

const settingsBtn = document.getElementById("settingsBtn");

const settingsBtn2 = document.getElementById("settingsBtn2");

const closeBtn = document.getElementById("closeBtn");

const closeBtn2 = document.getElementById("closeBtn2");

const closeBtn3 = document.getElementById("closeBtn3");

const homeView = document.getElementById("homeView");

const summaryView = document.getElementById("summaryView");

const settingsView = document.getElementById("settingsView");

const promptsSection = document.querySelector(".prompts");

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
  "content/extractors/gmail.js",
  "content/content.js",
];

let typingTimeoutId = null;

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
  console.log("ACTIVE TAB:");
  console.log(tab.url);
  console.log(tab.id);

  try {
    return await sendExtractMessage(tab.id);
  } catch (error) {
    console.error(error);
    console.log(
      "No content script receiver; injecting content scripts and retrying.",
    );

    await injectContentScripts(tab.id);

    return sendExtractMessage(tab.id);
  }
}

async function summarizePage(pageData) {
  const response = await fetch("http://127.0.0.1:8000/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: pageData.title,
      url: pageData.url,
      content: pageData.content,
      mode: "concise",
    }),
  });

  const summary = await response.text();

  if (!response.ok) {
    throw new Error(summary || `Summarize request failed: ${response.status}`);
  }

  return summary;
}

function typeTextByWord(element, text, speed = 45) {
  if (typingTimeoutId) {
    clearTimeout(typingTimeoutId);
  }

  const words = text.match(/\S+\s*/g) || [];
  let index = 0;

  element.textContent = "";

  return new Promise((resolve) => {
    function typeNextWord() {
      if (index >= words.length) {
        typingTimeoutId = null;
        resolve();
        return;
      }

      element.textContent += words[index];
      index += 1;
      typingTimeoutId = setTimeout(typeNextWord, speed);
    }

    typeNextWord();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const cached = await chrome.storage.local.get(tab.url);
    if (cached[tab.url]) {
      summaryText.textContent = cached[tab.url];
      homeView.classList.add("hidden");
      summaryView.classList.remove("hidden");
    }
  } catch (error) {
    console.error(error);
  }
  promptsSection.classList.remove("hidden");
  togglePromptsBtn.style.display = "none";
});

summarizeBtn?.addEventListener("click", async () => {
  homeView.classList.add("hidden");

  summaryView.classList.remove("hidden");

  summaryText.textContent = "Summarizing...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const pageData = await extractFromActiveTab(tab);

    console.log("PAGE DATA:", pageData);

    if (!pageData) {
      summaryText.textContent = "Could not extract page.";

      return;
    }

    const text = await summarizePage(pageData);

    await chrome.storage.local.set({
      [pageData.url]: text,
    });

    await typeTextByWord(summaryText, text);
  } catch (error) {
    console.error(error);

    summaryText.textContent = error.message;
  }
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

document.getElementById("askBtn")?.addEventListener("click", () => {
  homeView.classList.add("hidden");
  summaryView.classList.remove("hidden");
  document.querySelector(".chat-box textarea")?.focus();
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
