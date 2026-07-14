function extractGmail() {
  // Find the email subject
  const subjectEl = document.querySelector("h1.hP") || document.querySelector(".hP");
  const subject = subjectEl ? subjectEl.innerText : document.title;

  // Find all email message bodies in the active thread (handling conversation threads)
  const messageEls = document.querySelectorAll("div.a3s");

  if (messageEls.length === 0) {
    // No thread open (e.g. viewing the inbox list) — return empty content
    // rather than dumping the whole inbox chrome (contact list, labels,
    // ads), which is mostly noise for summarization.
    return {
      type: "gmail",
      title: subject,
      url: location.href,
      content: "",
    };
  }

  let content = "";
  messageEls.forEach((el, index) => {
    const text = el.innerText.trim();
    if (!text) return;

    // Each message body lives inside a ".adn" (or older ".gs") container
    // alongside the sender/date header and attachment list — walk up to it
    // to pull that context in.
    const messageContainer = el.closest(".adn") || el.closest(".gs");

    const senderEl = messageContainer?.querySelector(".gD");
    const sender =
      senderEl?.getAttribute("email") || senderEl?.innerText.trim() || "";

    const dateEl = messageContainer?.querySelector(".g3");
    const date = dateEl?.getAttribute("title") || dateEl?.innerText.trim() || "";

    const attachmentEls =
      messageContainer?.querySelectorAll(".aQH .aV3, .aZo .aV3") || [];
    const attachments = Array.from(attachmentEls)
      .map((a) => a.innerText.trim())
      .filter(Boolean);

    let header = `--- Message ${index + 1}`;
    if (sender) header += ` from ${sender}`;
    if (date) header += ` (${date})`;
    header += " ---";

    content += `${header}\n${text}\n`;
    if (attachments.length > 0) {
      content += `Attachments: ${attachments.join(", ")}\n`;
    }
    content += "\n";
  });

  return {
    type: "gmail",
    title: subject,
    url: location.href,
    content: content.trim(),
  };
}
