function extractGmail() {
  // Find the email subject
  const subjectEl = document.querySelector("h1.hP") || document.querySelector(".hP");
  const subject = subjectEl ? subjectEl.innerText : document.title;

  // Find all email message bodies in the active thread (handling conversation threads)
  const messageEls = document.querySelectorAll("div.a3s");
  let content = "";
  if (messageEls.length > 0) {
    messageEls.forEach((el, index) => {
      const text = el.innerText.trim();
      if (text) {
        content += `--- Message ${index + 1} ---\n${text}\n\n`;
      }
    });
  } else {
    content = document.body.innerText;
  }

  return {
    type: "gmail",
    title: subject,
    url: location.href,
    content: content.trim(),
  };
}
