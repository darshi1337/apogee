function extractGmail() {
  const subject = document.querySelector("h2")?.innerText || "";
  return {
    type: "email",
    title: subject,
    url: location.href,
    content: document.body.innerText,
  };
}
