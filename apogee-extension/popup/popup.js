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

const contentScriptFiles = [
  "content/Readability.js",
  "content/extractors/generic.js",
  "content/extractors/youtube.js",
  "content/extractors/gmail.js",
  "content/content.js",
];

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

    chrome.runtime.sendMessage(
      {
        action: "summarize",

        data: {
          title: pageData.title,

          url: pageData.url,

          content: pageData.content,

          mode: "concise",
        },
      },

      async (response) => {
        console.log("BACKGROUND RESPONSE:", response);

        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);

          summaryText.textContent = chrome.runtime.lastError.message;

          return;
        }

        if (!response) {
          summaryText.textContent = "No response from background.";

          return;
        }

        if (!response.success) {
          summaryText.textContent = response.error;

          return;
        }

        const text = response.summary;

        summaryText.textContent = text;

        await chrome.storage.local.set({
          [pageData.url]: text,
        });
      },
    );
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
