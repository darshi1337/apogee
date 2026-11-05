import test from "node:test";
import assert from "node:assert";
import { SUMMARY_LANGUAGES } from "../../lib/constants.js";
import { resolveLanguageName } from "../../lib/summarize/prompts.js";
import { resolveOpusModel } from "../../lib/language/opusTranslate.js";
import { applyAutoDirection } from "../../lib/util/markdown.js";

// --- #246: right-to-left summary languages ---

const RTL = { ar: "Arabic", he: "Hebrew", fa: "Persian", ur: "Urdu" };

test("Arabic, Hebrew, Persian and Urdu are selectable summary languages", () => {
  for (const [code, name] of Object.entries(RTL)) {
    const entry = SUMMARY_LANGUAGES.find((l) => l.code === code);
    assert.ok(entry, `${code} is listed`);
    assert.strictEqual(entry.name, name);
    assert.strictEqual(resolveLanguageName(code), name);
  }
  const codes = SUMMARY_LANGUAGES.map((l) => l.code);
  assert.strictEqual(new Set(codes).size, codes.length, "no duplicate codes");
});

test("RTL targets route through the multilingual Opus model", () => {
  const tokens = { ar: "ara", he: "heb", fa: "fas", ur: "urd" };
  for (const [code, token] of Object.entries(tokens)) {
    assert.deepStrictEqual(resolveOpusModel("en", code), {
      model: "Xenova/opus-mt-en-mul",
      token: `>>${token}<< `,
    });
    assert.strictEqual(
      resolveOpusModel(code, "en")?.model,
      "Xenova/opus-mt-mul-en",
    );
  }
});

test("applyAutoDirection marks each rendered block dir=auto", () => {
  const attrs = [];
  const nodes = ["p", "li", "ul"].map((tag) => ({
    tag,
    setAttribute: (k, v) => attrs.push([tag, k, v]),
  }));
  applyAutoDirection({ querySelectorAll: () => nodes });
  assert.deepStrictEqual(attrs, [
    ["p", "dir", "auto"],
    ["li", "dir", "auto"],
    ["ul", "dir", "auto"],
  ]);
  assert.doesNotThrow(() => applyAutoDirection(null));
});
