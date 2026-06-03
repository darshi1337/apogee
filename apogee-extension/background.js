console.log("BACKGROUND LOADED");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    fetch("http://127.0.0.1:8000/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.data),
    })
      .then((response) => response.text())
      .then((summary) => {
        console.log("SUMMARY RECEIVED:");
        console.log(summary);
        sendResponse({
          success: true,
          summary,
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message,
        });
      });
    return true;
  }
});
