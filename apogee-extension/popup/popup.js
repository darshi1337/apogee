const button = document.getElementById("summarizeBtn");
const status = document.getElementById("status");
const output = document.getElementById("output");

button.addEventListener("click", async () => {

    try {
        output.textContent = "";
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
                    console.log("Sending request to backend...");
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
