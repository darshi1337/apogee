console.log("CONTENT SCRIPT LOADED");

function extractPageContent() {
  const documentClone = document.cloneNode(true);
  const article = new Readability(documentClone).parse();
  if (!article) {
    console.log("Readability failed, using fallback");
    return {
      title: document.title,
      url: window.location.href,
      content: document.body.innerText,
    };
  }
  console.log(
    "Readability succeeded",
    "Extracted length:",
    article.textContent.length,
  );
  return {
    title: article.title,
    url: window.location.href,
    content: article.textContent,
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    sendResponse(extractPageContent());
  }
});
