# Apogee Translation Architecture and Reference

Apogee can produce its summaries, Q&A answers, and suggested questions in a language other than the source page. You can pick an output language under Settings, then Summary language. The default is English (summaries come out in English no matter what language the page is in), and "Same as article" keeps the page own language. 29 target languages are supported.

## Translation Engines

Under the hood there are two translation engines, selectable under Settings, then Translation engine:

- **Opus-MT (default)**: A dedicated Helsinki-NLP Opus-MT translation model. The summary is generated neutrally (in English), then translated by a purpose-built model: deterministic, structure-preserving (bullets and `[MM:SS](url)` timestamp links are kept intact), and noticeably stronger on the low-resource long tail. Each model is a small (~80 MB) ONNX file downloaded from Hugging Face on first use and cached offline. Any language Opus-MT cannot reach automatically falls back to the LLM engine.
- **LLM (opt-in)**: The summarization model translates as it writes: one generation pass with a system-level "write in X" directive, the output is language-checked, and only if the model slipped does an explicit translate pass run. No extra download; it reuses the model already loaded for summarizing. Works for every language, but small in-browser models get weaker the further a language sits from English.

## Complete 29-Language Matrix

Opus-MT is English-centric, so it uses one of three tiers per language. The table below is the English-to-target path used when translating a summary:

| Target Language | Opus-MT Model (English-to-Target) | Tier | Recommended Engine |
| --- | --- | --- | --- |
| Spanish | `opus-mt-en-es` | Dedicated model | Opus (Default) |
| French | `opus-mt-en-fr` | Dedicated model | Opus (Default) |
| German | `opus-mt-en-de` | Dedicated model | Opus (Default) |
| Italian | `opus-mt-en-it` | Dedicated model | Opus (Default) |
| Dutch | `opus-mt-en-nl` | Dedicated model | Opus (Default) |
| Russian | `opus-mt-en-ru` | Dedicated model | Opus (Default) |
| Chinese (Simplified) | `opus-mt-en-zh` | Dedicated model | Opus (Default) |
| Japanese | `opus-mt-en-jap` | Dedicated model | Opus (Default) |
| Ukrainian | `opus-mt-en-uk` | Dedicated model | Opus (Default) |
| Czech | `opus-mt-en-cs` | Dedicated model | Opus (Default) |
| Romanian | `opus-mt-en-ro` | Dedicated model | Opus (Default) |
| Hungarian | `opus-mt-en-hu` | Dedicated model | Opus (Default) |
| Swedish | `opus-mt-en-sv` | Dedicated model | Opus (Default) |
| Danish | `opus-mt-en-da` | Dedicated model | Opus (Default) |
| Finnish | `opus-mt-en-fi` | Dedicated model | Opus (Default) |
| Indonesian | `opus-mt-en-id` | Dedicated model | Opus (Default) |
| Portuguese | `opus-mt-en-mul (>>por<<)` | Grouped model | Opus (Default) |
| Polish | `opus-mt-en-mul (>>pol<<)` | Grouped model | Opus (Default) |
| Slovenian | `opus-mt-en-mul (>>slv<<)` | Grouped model | Opus (Default) |
| Bulgarian | `opus-mt-en-mul (>>bul<<)` | Grouped model | Opus (Default) |
| Greek | `opus-mt-en-mul (>>ell<<)` | Grouped model | Opus (Default) |
| Turkish | `opus-mt-en-mul (>>tur<<)` | Grouped model | Opus (Default) |
| Norwegian | `opus-mt-en-mul (>>nob<<)` | Grouped model | Opus (Default) |
| Estonian | `opus-mt-en-mul (>>est<<)` | Grouped model | Opus (Default) |
| Latvian | `opus-mt-en-mul (>>lav<<)` | Grouped model | Opus (Default) |
| Lithuanian | `opus-mt-en-mul (>>lit<<)` | Grouped model | Opus (Default) |
| Slovak | `none (LLM only)` | No Opus model | LLM (only option) |
| Korean | `none (LLM only)` | No Opus model | LLM (only option) |
| Chinese (Traditional) | `none (LLM only)` | No Opus model | LLM (only option) |

## Understanding Translation Tiers and Directions

- **Dedicated model**: A small, single-pair Opus-MT model (`opus-mt-en-<code>`), which is the highest-quality tier. For well-resourced languages (Spanish, French, German, Italian, Dutch, Russian, Chinese, Japanese) both engines work well, but Opus is default for structure preservation.
- **Grouped model**: The multilingual `opus-mt-en-mul` model, steered to the target with a `>>code<<` token. These cover the lower-resource languages that Opus-MT handles with high fluency.
- **No Opus model**: Slovak, Korean, and Traditional Chinese have no English-to-target Opus-MT path, so they always use the LLM engine (choosing Opus for these silently falls back to the LLM anyway).

When translating the other direction (a non-English page summarized in English), Opus-MT uses the matching `opus-mt-<code>-en` dedicated models where they exist and the grouped `opus-mt-mul-en` catch-all otherwise. Non-English-to-non-English pairs are not translated directly and fall back to the LLM engine.
