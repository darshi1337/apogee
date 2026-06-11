function extractPageContent() {
  const url = window.location.href.toLowerCase();

  if (url.endsWith(".pdf") || document.contentType === "application/pdf") {
    return {
      title: document.title,
      url: window.location.href,
      content: null,
      isPdf: true,
    };
  }

  const documentClone = document.cloneNode(true);

  const article = new Readability(documentClone).parse();

  if (!article) {
    console.log("Readability failed, using fallback");

    return {
      title: document.title,
      url: window.location.href,
      content: document.body.innerText,
      isPdf: false,
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
    isPdf: false,
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    sendResponse(extractPageContent());
  }
});
