function extractPageContent() {
    return {
        title: document.title,
        url: window.location.href,
        content: document.body.innerText
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extract") {
        sendResponse(
            extractPageContent()
        );
    }
});