console.log(typeof extractGeneric);
console.log(typeof extractYoutube);
console.log(typeof extractGmail);

function extractPageContent() {
  const host = window.location.hostname;
  console.log("Host:", host);

  if (host.includes("youtube.com")) {
    console.log("Using YouTube extractor");
    return extractYoutube();
  }
  if (host.includes("mail.google.com")) {
    console.log("Using Gmail extractor");
    return extractGmail();
  }
  console.log("Using Generic extractor");
  return extractGeneric();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    sendResponse(extractPageContent());
  }
});
