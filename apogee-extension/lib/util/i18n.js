import enMessages from "../../_locales/en/messages.json" with { type: "json" };

function lookupFallback(key) {
  const entry = enMessages?.[key];
  if (typeof entry?.message === "string") return entry.message;
  return "";
}

export function t(key, substitutions) {
  try {
    const api = globalThis.chrome?.i18n;
    if (api?.getMessage) {
      const msg = api.getMessage(key, substitutions);
      if (msg) return msg;
    }
  } catch {
    // Fall back to the bundled message when the i18n API is unavailable.
  }
  const fallback = lookupFallback(key);
  if (fallback) return fallback;
  return key;
}

const TEXT_ATTRS = [
  ["data-i18n", "textContent"],
  ["data-i18n-aria-label", "ariaLabel"],
  ["data-i18n-title", "title"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-alt", "alt"],
  ["data-i18n-content", "textContent"],
];

export function applyI18nToDom(root = globalThis.document) {
  if (!root?.querySelectorAll) return 0;
  let count = 0;
  for (const [attr, prop] of TEXT_ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = el.getAttribute(attr);
      if (!key) continue;
      const msg = t(key);
      if (!msg || msg === key) continue;
      if (prop === "textContent") {
        el.textContent = msg;
      } else if (prop === "ariaLabel") {
        el.setAttribute("aria-label", msg);
      } else {
        el[prop] = msg;
      }
      count += 1;
    }
  }
  const htmlLang = t("appHtmlLang");
  if (root.documentElement && htmlLang && htmlLang !== "appHtmlLang") {
    root.documentElement.lang = htmlLang;
  }
  return count;
}
