console.log("chrome =", typeof chrome);
console.log("chrome.storage =", chrome?.storage);

const button = document.getElementById("summarizeBtn");
const status = document.getElementById("status");
const output = document.getElementById("output");
const backBtn = document.getElementById("backBtn");

const homeView = document.getElementById("homeView");
const summaryView = document.getElementById("summaryView");

document.addEventListener(
    "DOMContentLoaded",
    async () => {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });
        const cached = await chrome.storage.local.get(
            tab.url
        );
        if (cached[tab.url]) {
            output.textContent = cached[tab.url];
            homeView.classList.add("hidden");
            summaryView.classList.remove("hidden");
        }
    }
);

backBtn?.addEventListener("click", () => {
    summaryView.classList.add("hidden");
    homeView.classList.remove("hidden");

});

button.addEventListener("click", async () => {
    try {
        status.textContent = "Extracting page...";
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });
        chrome.tabs.sendMessage(
            tab.id,
            { action: "extract" },
            async (pageData) => {
                try {
                    console.log("Page data:");
                    console.log(pageData);
                    status.textContent = "Summarizing...";
                    console.log("PAGE DATA");
                    console.log(pageData);
                    console.log("URL:", pageData.url);
                    console.log("TITLE:", pageData.title);
                    console.log(
                        "CONTENT:",
                        pageData.content?.slice(0, 500)
                    );
                    chrome.runtime.sendMessage(
                        {
                            action: "summarize",
                            data: {
                                title: pageData.title,
                                url: pageData.url,
                                content: pageData.content,
                                mode: "concise"
                            }
                        },
                        async (response) => {
                            console.log(
                                "BACKGROUND RESPONSE:"
                            );
                            console.log(response);
                            if (!response) {
                                status.textContent =
                                    "Error";
                                output.textContent =
                                    "No response from background.js";
                                return;
                            }
                            if (!response.success) {
                                throw new Error(
                                    response.error
                                );
                            }
                            const text = response.summary;
                            output.textContent = text;
                            await chrome.storage.local.set({
                                [pageData.url]: text
                            });
                            homeView.classList.add(
                                "hidden"
                            );
                            summaryView.classList.remove(
                                "hidden"
                            );
                            status.textContent =
                                "Done";
                        }
                    );
                } catch (error) {
                    console.error(error);
                    status.textContent = "Error";
                    output.textContent =
                        error.message;
                }
            }
        );
    } catch (error) {
        console.error(error);
        status.textContent = "Error";
        output.textContent =
            error.message;
    }
});
