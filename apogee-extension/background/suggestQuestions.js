import { resolveEffectiveLanguage } from "../lib/language/detectLanguage.js";
import { generateInTargetLanguage } from "../lib/language/languageOutput.js";
import { opusTranslateFnFor } from "../lib/language/opusTranslateEngine.js";
import { buildSuggestQuestionsPrompt } from "../lib/summarize/prompts.js";
import { parseSuggestedQuestions } from "../lib/summarize/questions.js";
import {
  withTransformersEngine,
  transformersChatStream,
} from "../lib/engines/transformersEngine.js";
import { getSettings } from "../lib/storage/settings.js";
import { shouldPersist } from "../lib/storage/pageCache.js";
import { PROVIDERS } from "../lib/constants.js";
import {
  OLLAMA_PROVIDER,
  LLAMACPP_PROVIDER,
  validateLoopbackHost,
} from "./loopbackProviders.js";
import {
  hasOffscreenAPI,
  startKeepAlive,
  trackBackgroundJob,
  untrackBackgroundJob,
} from "./streams.js";

// Distinguishable outcomes for skip-segment / subtitle lookups (#306):
// callers previously saw [] for denied permission, network failure, and
// genuinely-empty alike. Each lookup below reports which one happened via
// its status field so denied/off, network errors, and empty stay distinct.
export const SKIP_LOOKUP_STATUS = {
  OK: "ok",
  OFF: "off",
  DENIED: "denied",
  INVALID: "invalid",
  NETWORK: "network-error",
  EMPTY: "empty",
};

export async function generateQuestionsFromChat(
  chat,
  { title, url, summary, language, translationEngine },
) {
  const prompt = buildSuggestQuestionsPrompt(title, url, summary);
  const qLanguage = await resolveEffectiveLanguage(summary, language);
  const translateFn = opusTranslateFnFor(translationEngine);
  const text = await generateInTargetLanguage(chat, prompt, qLanguage, {
    translateFn,
  });
  return parseSuggestedQuestions(text);
}

export async function generateTransformersSuggestions(
  model,
  { title, url, summary, language, translationEngine },
) {
  return withTransformersEngine(model, null, async (eng) =>
    generateQuestionsFromChat(
      (p, opts) => transformersChatStream(eng, p, { system: opts?.system }),
      { title, url, summary, language, translationEngine },
    ),
  );
}

export async function generateLocalSuggestions(
  host,
  model,
  { title, url, summary, language, translationEngine },
  client = OLLAMA_PROVIDER,
  apiKey = "",
) {
  const validHost = validateLoopbackHost(host, client.label);
  return generateQuestionsFromChat(
    (p, opts) => client.chatStream(validHost, model, p, { ...opts, apiKey }),
    { title, url, summary, language, translationEngine },
  );
}

// Fire-and-forget follow-up-question job: a failed engine means empty
// suggestions, never a failed run. ensureOffscreenDocument arrives from the
// worker so this module never imports it back (one-way dependencies).
export async function runSuggestQuestionsJob(
  payload,
  { ensureOffscreenDocument } = {},
) {
  const {
    promptsCacheKey,
    persist = true,
    persistUrl,
    providerType,
    host,
    title,
    url,
    summary,
    model,
    language,
    translationEngine,
  } = payload || {};
  if (!trackBackgroundJob(promptsCacheKey)) return;
  startKeepAlive();

  let questions = [];
  let suggestStatus = SKIP_LOOKUP_STATUS.EMPTY;
  try {
    try {
      if (
        providerType === PROVIDERS.LLAMACPP ||
        providerType === PROVIDERS.LOCAL
      ) {
        const isLlama = providerType === PROVIDERS.LLAMACPP;
        const { llamaHost, llamaApiKey } = isLlama ? await getSettings() : {};
        questions = await generateLocalSuggestions(
          isLlama ? llamaHost : host,
          model,
          { title, url, summary, language, translationEngine },
          isLlama ? LLAMACPP_PROVIDER : undefined,
          isLlama ? llamaApiKey : undefined,
        );
      } else if (providerType === PROVIDERS.TRANSFORMERS && !hasOffscreenAPI) {
        questions = await generateTransformersSuggestions(model, {
          title,
          url,
          summary,
          language,
          translationEngine,
        });
      } else {
        await ensureOffscreenDocument?.();
        const resp = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "suggest-questions",
          payload: {
            title,
            url,
            summary,
            model,
            language,
            translationEngine,
            provider:
              providerType === PROVIDERS.TRANSFORMERS
                ? "transformers"
                : "webllm",
          },
        });
        questions = resp?.questions || [];
      }
      suggestStatus =
        questions.length > 0 ? SKIP_LOOKUP_STATUS.OK : SKIP_LOOKUP_STATUS.EMPTY;
    } catch (err) {
      questions = [];
      suggestStatus = SKIP_LOOKUP_STATUS.NETWORK;
      // Telemetry-safe: provider type + error name only, never title/summary.
      console.warn(
        `Suggest-questions unavailable: ${providerType || "unknown"} ${err?.name || "Error"}.`,
      );
    }

    // Generating the questions takes its own trip through the model, so the setting gets one more look before this write too.
    // A quota-full disk must not take down finalize: keep the in-memory
    // questions for the popup even when the cache write rejects.
    try {
      if (persist && (await shouldPersist(persistUrl || url))) {
        await chrome.storage.local.set({ [promptsCacheKey]: questions });
      }
    } catch (err) {
      console.error("Failed to cache suggested questions:", err);
    }
    chrome.runtime
      .sendMessage({
        type: "suggested-prompts-ready",
        promptsCacheKey,
        questions,
        status: suggestStatus,
      })
      .catch(() => {});
  } catch (err) {
    console.error("Suggest-questions job failed:", err);
    try {
      chrome.runtime
        .sendMessage({
          type: "suggested-prompts-ready",
          promptsCacheKey,
          questions,
          status: suggestStatus,
        })
        .catch(() => {});
    } catch {
      // intent: best-effort, ignore if already closed/unavailable
    }
  } finally {
    untrackBackgroundJob(promptsCacheKey);
  }
}
