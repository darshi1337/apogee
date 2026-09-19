const EN_MUL_TOKEN = {
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  pt: "por",
  nl: "nld",
  pl: "pol",
  ru: "rus",
  uk: "ukr",
  cs: "ces",
  sl: "slv",
  bg: "bul",
  ro: "ron",
  hu: "hun",
  el: "ell",
  tr: "tur",
  sv: "swe",
  da: "dan",
  nb: "nob",
  fi: "fin",
  et: "est",
  lv: "lav",
  lt: "lit",
  ja: "jpn",
  zh: "cmn",
  id: "ind",
};

const DIRECT_EN_TO = new Set([
  "es",
  "fr",
  "de",
  "it",
  "nl",
  "ru",
  "uk",
  "cs",
  "ro",
  "sv",
  "da",
  "fi",
  "hu",
  "zh",
  "id",
  "ja",
]);

const DIRECT_TO_EN = new Set([
  "es",
  "fr",
  "de",
  "it",
  "nl",
  "ru",
  "uk",
  "cs",
  "fi",
  "sv",
  "da",
  "zh",
  "id",
  "ja",
  "ko",
  "tr",
  "et",
  "hu",
  "pl",
]);

const DIRECT_MODEL_CODE = { ja: "jap" };

function directCode(lang) {
  return DIRECT_MODEL_CODE[lang] || lang;
}

export function resolveOpusModel(src, tgt) {
  if (!src || !tgt) return null;
  // No translator when source and target are the same language, compared by
  // base code and case-insensitively: detection yields variants like "en"
  // while settings may carry "en-US", and loading a model to translate a
  // language into itself is pure waste.
  const base = (code) => String(code).toLowerCase().split("-")[0];
  if (base(src) === base(tgt)) return null;

  if (src === "en") {
    if (DIRECT_EN_TO.has(tgt)) {
      return { model: `Xenova/opus-mt-en-${directCode(tgt)}`, token: "" };
    }
    if (EN_MUL_TOKEN[tgt]) {
      return {
        model: "Xenova/opus-mt-en-mul",
        token: `>>${EN_MUL_TOKEN[tgt]}<< `,
      };
    }
    return null;
  }

  if (tgt === "en") {
    if (DIRECT_TO_EN.has(src)) {
      return { model: `Xenova/opus-mt-${directCode(src)}-en`, token: "" };
    }
    return { model: "Xenova/opus-mt-mul-en", token: "" };
  }

  return null;
}

const LEADING_PREFIX =
  /^(\s*(?:#{1,6}\s+|[-*]\s+|\d+\.\s+)?(?:\[[^\]]*\]\([^)]*\):?\s*)?)/;

export function splitTranslatablePrefix(line) {
  const match = line.match(LEADING_PREFIX);
  const prefix = match ? match[0] : "";
  return { prefix, rest: line.slice(prefix.length) };
}

const TRANSLATE_BATCH_SIZE = 8;

export async function translatePreservingStructure(
  text,
  translateBatch,
  { onProgress, batchSize = TRANSLATE_BATCH_SIZE } = {},
) {
  const lines = text.split("\n");
  const parts = lines.map(splitTranslatablePrefix);
  const jobs = [];
  parts.forEach((p, i) => {
    if (p.rest.trim()) jobs.push({ i, rest: p.rest });
  });
  jobs.sort((a, b) => a.rest.length - b.rest.length);

  const out = lines.slice();
  let done = 0;
  for (let start = 0; start < jobs.length; start += batchSize) {
    const chunk = jobs.slice(start, start + batchSize);
    const translated = await translateBatch(chunk.map((j) => j.rest));
    chunk.forEach((j, k) => {
      out[j.i] = parts[j.i].prefix + (translated[k] ?? j.rest);
    });
    done += chunk.length;
    onProgress?.(done, jobs.length);
  }
  return out.join("\n");
}
