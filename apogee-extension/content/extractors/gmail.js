function sanitizeHeaderValue(str) {
  if (!str) return "";
  const clean = Array.from(str)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : ch;
    })
    .join("");
  return clean.replace(/\s+/g, " ").trim();
}

function extractGmail() {
  const subjectEl =
    document.querySelector("h1.hP") || document.querySelector(".hP");
  const subject = elText(subjectEl) || document.title;

  const messageEls = liveEls(document.querySelectorAll("div.a3s"));

  if (messageEls.length === 0) {
    return {
      type: "gmail",
      title: subject,
      url: location.href,
      content: "",
    };
  }

  let content = "";
  messageEls.forEach((el, index) => {
    if (!el || (typeof el.isConnected !== "undefined" && !el.isConnected))
      return;
    const text = elText(el);
    if (!text) return;

    const messageContainer = el.closest?.(".adn") || el.closest?.(".gs");

    const senderEl = messageContainer?.querySelector?.(".gD");
    const rawSender = senderEl?.getAttribute("email") || elText(senderEl);
    const sender = sanitizeHeaderValue(rawSender);

    const dateEl = messageContainer?.querySelector?.(".g3");
    const rawDate = dateEl?.getAttribute("title") || elText(dateEl);
    const date = sanitizeHeaderValue(rawDate);

    const attachmentEls = Array.from(
      messageContainer?.querySelectorAll?.(".aQH .aV3, .aZo .aV3") || [],
    );
    const attachments = attachmentEls.map((a) => elText(a)).filter(Boolean);

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
