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
                    const response = await fetch(
                        "http://127.0.0.1:8000/summarize",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                title: pageData.title,
                                url: pageData.url,
                                content: pageData.content,
                                mode: "concise"
                            })
                        }
                    );
                    console.log("Response received");
                    console.log(response.status);
                    if (!response.ok) {
                        throw new Error(
                            `Backend returned ${response.status}`
                        );
                    }
                    const text = await response.text();
                    console.log("TEXT RECEIVED");
                    console.log(text);
                    output.textContent = text;
                    await chrome.storage.local.set({
                        [pageData.url]: text
                    });
                    homeView.classList.add("hidden");
                    summaryView.classList.remove("hidden");
                    status.textContent = "Done";
                } catch (error) {
                    console.error(error);
                    status.textContent = "Error";
                    output.textContent = error.message;
                }
            }
        );
    } catch (error) {
        console.error(error);
        status.textContent = "Error";
        output.textContent = error.message;
    }
});
