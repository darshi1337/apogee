# Apogee Translation Architecture and Reference

Apogee can make summaries, answers to questions, and suggested questions in a language different from the original page. You choose the output language under Settings, then Summary language. The normal setting is English (summaries will be in English no matter what language the original page was). “Same as article” keeps the original page’s language. There are 32 languages you can use.

## Translation Engines

There are two translation engines used:

- **Opus-MT (default)**: This is a model from Helsinki-NLP. It makes summaries in English, then translates them using a special tool. It keeps the structure of the text (like bullet points and links) and works best for languages that aren’t as common. Each model is small (~80 MB) and downloaded when you first use it, then saved for later. If Opus-MT doesn't understand a language automatically, it uses another engine.
- **LLM (opt-in)**: This engine translates while it writes. It tries to make the summary in the target language directly. It checks the language carefully and only does an extra translation step if needed. It’s always available, but smaller models might be weaker when translating languages that are far from English.

## Complete 32-Language Matrix

Opus-MT is mainly for English, so it uses different levels for each language. Here's a table showing how it translates from English to other languages:

| Target Language | Opus-MT Model (English-to-Target) | Tier        | Recommended Engine |
| :--------------- | :---------------------------------- | :---------- | :------------------ |
| Spanish          | `opus-mt-en-es`                      | Dedicated   | Opus (Default)      |
| French           | `opus-mt-en-fr`                      | Dedicated   | Opus (Default)      |
| German           | `opus-mt-en-de`                      | Dedicated   | Opus (Default)      |
| Italian          | `opus-mt-en-it`                      | Dedicated   | Opus (Default)      |
| Dutch            | `opus-mt-en-nl`                      | Dedicated   | Opus (Default)      |
| Russian          | `opus-mt-en-ru`                      | Dedicated   | Opus (Default)      |
| Chinese (Simplified)| `opus-mt-en-zh`                     | Dedicated   | Opus (Default)      |
| Japanese         | `opus-mt-en-jap`                     | Dedicated   | Opus (Default)      |
| Ukrainian        | `opus-mt-en-uk`                      | Dedicated   | Opus (Default)      |
| Czech            | `opus-mt-en-cs`                      | Dedicated   | Opus (Default)      |
| Romanian         | `opus-mt-en-ro`                      | Dedicated   | Opus (Default)      |
| Hungarian        | `opus-mt-en-hu`                      | Dedicated   | Opus (Default)      |
| Swedish          | `opus-mt-en-sv`                      | Dedicated   | Opus (Default)      |
| Danish           | `opus-mt-en-da`                      | Dedicated   | Opus (Default)      |
| Finnish          | `opus-mt-en-fi`                      | Dedicated   | Opus (Default)      |
| Indonesian       | `opus-mt-en-id`                      | Dedicated   | Opus (Default)      |
| Portuguese       | `opus-mt-en-mul (>>por<<)`           | Grouped     | Opus (Default)      |
| Polish           | `opus-mt-en-mul (>>pol<<)`           | Grouped     | Opus (Default)      |
| Slovenian        | `opus-mt-en-mul (>>slv<<)`           | Grouped     | Opus (Default)      |
| Bulgarian        | `opus-mt-en-mul (>>bul<<)`           | Grouped     | Opus (Default)      |
| Greek            | `opus-mt-en-mul (>>ell<<)`           | Grouped     | Opus (Default)      |
| Turkish          | `opus-mt-en-mul (>>tur<<)`           | Grouped     | Opus (Default)      |
| Norwegian        | `opus-mt-en-mul (>>nob<<)`           | Grouped     | Opus (Default)      |
| Estonian         | `opus-mt-en-mul (>>est<<)`           | Grouped     | Opus (Default)      |
| Latvian          | `opus-mt-en-mul (>>lav<<)`           | Grouped     | Opus (Default)      |
| Lithuanian       | `opus-mt-en-mul (>>lit<<)`           | Grouped     | Opus (Default)      |
| Slovak           | `none (LLM only)`                   | No Opus     | LLM (only option)   |
| Korean           | `none (LLM only)`                   | No Opus     | LLM (only option)   |
| Chinese (Traditional)| `none (LLM only)`                   | No Opus     | LLM (only option)   |
| Hindi            | `none (LLM only)`                   | No Opus     | LLM (only option)   |
| Vietnamese       | `none (LLM only)`                   | No Opus     | LLM (only option)   |
| Thai             | `none (LLM only)`                   | No Opus     | LLM (only option)   |

## Understanding Translation Tiers and Directions

- **Dedicated model**: This is a small, single-pair model (`opus-mt-en-<code>`). It’s the best quality level. It works well for languages like Spanish, French, German, etc. Opus is the default because it keeps the structure of the text (like bullet points and links) better.
- **Grouped model**: This uses a multilingual model (`opus-mt-en-mul`) with a special code to tell it what language to use. It's good for languages that aren’t as common.
- **No Opus model**: Slovak, Korean, Traditional Chinese, Hindi, Vietnamese, and Thai don’t have an English-to-target Opus-MT path. So, they always use the LLM engine (Opus falls back to the LLM anyway).
