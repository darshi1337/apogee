import { resolveLanguageName } from "../summarize/prompts.js";

export function baseCode(code) {
  return (code || "").toLowerCase().split("-")[0];
}

export function detectedMatchesTarget(detected, target) {
  return !!detected && baseCode(detected) === baseCode(target);
}

export async function detectPrimaryLanguage(text) {
  try {
    const i18n = globalThis.chrome?.i18n || globalThis.browser?.i18n;
    if (!i18n?.detectLanguage) return null;
    const sample = (text || "").slice(0, 2000).trim();
    if (!sample) return null;
    const result = await i18n.detectLanguage(sample);
    const langs = result?.languages || [];
    if (!langs.length) return null;
    const top = langs.reduce((a, b) => (b.percentage > a.percentage ? b : a));
    return top.percentage >= 50 ? top.language : null;
  } catch {
    return null;
  }
}

export async function resolveEffectiveLanguage(text, targetLang) {
  if (!resolveLanguageName(targetLang)) return "auto";
  const source = await detectPrimaryLanguage(text);
  if (source && baseCode(source) === baseCode(targetLang)) return "auto";
  return targetLang;
}
