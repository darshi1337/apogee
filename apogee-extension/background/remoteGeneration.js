import { getSettings } from "../lib/storage/settings.js";
import { getRemoteSettings } from "../lib/storage/remoteSettings.js";
import { REMOTE_PROVIDER_IDS } from "../lib/engines/remoteModels.js";
import { hasRemoteGenerationPermissions } from "../lib/engines/remoteCredentials.js";
import { streamRemoteChat } from "../lib/engines/remoteClient.js";
import { getMaxChunkChars } from "../lib/engines/modelLimits.js";
import { MAX_PASTED_CHARS } from "../lib/extract/fileLimits.js";
import { summarizeText } from "../lib/summarize/ollamaSummarize.js";
import { chunkBySections } from "../lib/summarize/sections.js";
import {
  buildAnswerPrompt,
  withCustomInstructions,
} from "../lib/summarize/prompts.js";
import { resolveEffectiveLanguage } from "../lib/language/detectLanguage.js";
import { streamInTargetLanguage } from "../lib/language/languageOutput.js";
import { opusTranslateFnFor } from "../lib/language/opusTranslateEngine.js";
import { UserFacingError } from "../lib/util/userError.js";

export const isRemoteProvider = (provider) =>
  REMOTE_PROVIDER_IDS.includes(provider);
export const REMOTE_B1_UNSUPPORTED =
  "Remote background and multi-tab generation are not available in this stage. Use Summary or Ask in the Apogee panel.";
const AUTHORIZATION_CHANGED =
  "Remote generation authorization changed. Review Settings and start a new request.";

export function validateRemoteGenerationPayload(payload) {
  const fields = new Set([
    "action",
    "title",
    "url",
    "content",
    "mode",
    "type",
    "question",
    "finalize",
    "isSelection",
    "focusKeyword",
  ]);
  const invalid = () => {
    throw new UserFacingError("Invalid remote generation request.");
  };
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !fields.has(key)) ||
    !["summarize", "ask"].includes(payload.action)
  )
    invalid();
  const bounds = {
    title: 2000,
    url: 8192,
    content: MAX_PASTED_CHARS,
    mode: 40,
    type: 80,
    question: 20000,
    focusKeyword: 2000,
  };
  for (const [field, limit] of Object.entries(bounds)) {
    if (
      payload[field] != null &&
      (typeof payload[field] !== "string" || payload[field].length > limit)
    )
      invalid();
  }
  if (
    !payload.content?.trim() ||
    (payload.action === "ask" && !payload.question?.trim())
  )
    invalid();
  if (payload.isSelection != null && typeof payload.isSelection !== "boolean")
    invalid();
  if (payload.finalize != null) {
    const final = payload.finalize;
    const allowed = new Set([
      "customContent",
      "isSelection",
      "pageType",
      "selectionText",
      "jobId",
      "tabId",
      "windowId",
      "notifyOnFinish",
      "persistUrl",
    ]);
    if (
      typeof final !== "object" ||
      Array.isArray(final) ||
      Object.keys(final).some((key) => !allowed.has(key))
    )
      invalid();
    for (const field of ["customContent", "isSelection", "notifyOnFinish"])
      if (final[field] != null && typeof final[field] !== "boolean") invalid();
    for (const field of ["tabId", "windowId"])
      if (final[field] != null && !Number.isSafeInteger(final[field]))
        invalid();
    for (const [field, limit] of Object.entries({
      pageType: 80,
      selectionText: MAX_PASTED_CHARS,
      jobId: 200,
      persistUrl: 8192,
    }))
      if (
        final[field] != null &&
        (typeof final[field] !== "string" || final[field].length > limit)
      )
        invalid();
  }
  return { ...payload };
}

// Local retrieval and translation may not accept AbortSignal. Stop waiting for
// them on revocation, and check again before their output can reach a provider.
export function awaitRemoteStep(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new UserFacingError(AUTHORIZATION_CHANGED));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function createRemoteJobContext({ signal } = {}) {
  const controller = new AbortController();
  let settings;
  const abort = () => controller.abort();
  const changed = (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const { oldValue = {}, newValue = {} } = changes.settings;
    const providers = settings ? [settings.provider] : REMOTE_PROVIDER_IDS;
    if (
      oldValue.provider !== newValue.provider ||
      oldValue.autoEngine !== newValue.autoEngine ||
      providers.some((provider) =>
        [
          "ApiKey",
          "Consent",
          "GenerationConsent",
          "GenerationRevision",
          "Model",
        ].some(
          (suffix) =>
            oldValue[`${provider}${suffix}`] !==
            newValue[`${provider}${suffix}`],
        ),
      )
    )
      abort();
  };
  const permissionsRemoved = (permissions) => {
    if (
      permissions.data_collection?.some((category) =>
        [
          "authenticationInfo",
          "websiteContent",
          "browsingActivity",
          "personalCommunications",
        ].includes(category),
      )
    )
      abort();
  };
  chrome.storage.onChanged?.addListener(changed);
  chrome.permissions?.onRemoved?.addListener(permissionsRemoved);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const dispose = () => {
    chrome.storage.onChanged?.removeListener(changed);
    chrome.permissions?.onRemoved?.removeListener(permissionsRemoved);
    signal?.removeEventListener("abort", abort);
    abort();
  };
  try {
    const saved = await getSettings();
    const provider = saved.provider;
    if (!isRemoteProvider(provider) || saved.autoEngine)
      throw new UserFacingError(
        "Select a remote provider explicitly with automatic engine selection off.",
      );
    settings = Object.freeze(
      Object.fromEntries(
        [
          "provider",
          "autoEngine",
          `${provider}Model`,
          `${provider}GenerationRevision`,
          "summaryLanguage",
          "translationEngine",
          "customInstructions",
          "responseFormat",
          "privateHosts",
          "saveHistory",
        ].map((field) => [field, saved[field]]),
      ),
    );
    const model = settings[`${provider}Model`];
    const revision = settings[`${provider}GenerationRevision`];
    const assertActive = async () => {
      const current = await getSettings();
      if (
        controller.signal.aborted ||
        current.provider !== provider ||
        current.autoEngine ||
        current[`${provider}Consent`] !== true ||
        current[`${provider}GenerationConsent`] !== true ||
        current[`${provider}Model`] !== model ||
        current[`${provider}GenerationRevision`] !== revision ||
        !(await hasRemoteGenerationPermissions())
      ) {
        abort();
        throw new UserFacingError(AUTHORIZATION_CHANGED);
      }
      if (controller.signal.aborted)
        throw new UserFacingError(AUTHORIZATION_CHANGED);
    };
    await assertActive();
    const setup = (await getRemoteSettings()).providers[provider];
    const entry = setup.catalog.models.find((entry) => entry.id === model);
    if (!setup.hasApiKey || !entry || setup.catalog.stale)
      throw new UserFacingError(
        "Save a key, refresh the catalog and select an eligible remote model.",
      );
    await assertActive();
    const maxPromptChars = Math.min(
      180000,
      getMaxChunkChars(model, entry.contextTokens || 8192),
    );
    return {
      provider,
      model,
      settings,
      controller,
      signal: controller.signal,
      assertActive,
      dispose,
      // Reserve prompt and instruction overhead in addition to the model's
      // output-token reserve. Tiny catalogs fail closed at the chat boundary.
      chunkChars: Math.max(256, maxPromptChars - 6000),
      maxPromptChars,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function* remoteChatStream(context, prompt, { system } = {}) {
  await context.assertActive();
  if (prompt.length + (system?.length || 0) > context.maxPromptChars)
    throw new UserFacingError(
      "The remote model context is too small for this request. Select a model with a larger context window.",
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  context.signal.addEventListener("abort", abort, { once: true });
  if (context.signal.aborted) abort();
  const queue = [];
  let wake;
  let done = false;
  let error;
  const task = streamRemoteChat(context.provider, prompt, {
    signal: controller.signal,
    system,
    assertAuthorized: context.assertActive,
    onToken: (token) => {
      queue.push(token);
      wake?.();
    },
  })
    .catch((failure) => {
      error = failure;
    })
    .finally(() => {
      done = true;
      wake?.();
    });
  try {
    while (!done || queue.length) {
      if (context.signal.aborted) await context.assertActive();
      if (queue.length) yield queue.shift();
      else
        await new Promise((resolve) => {
          wake = resolve;
        });
    }
    if (error) throw error;
    await context.assertActive();
  } finally {
    controller.abort();
    context.signal.removeEventListener("abort", abort);
    await task;
  }
}

export async function* generateRemote(
  context,
  payload,
  { getRelevantContent, onProgress } = {},
) {
  const { settings, model, signal } = context;
  const step = (promise) => awaitRemoteStep(promise, signal);
  await context.assertActive();
  const language = await step(
    resolveEffectiveLanguage(payload.content, settings.summaryLanguage),
  );
  const translate = opusTranslateFnFor(settings.translationEngine, onProgress);
  const translateFn = translate
    ? async (...args) => {
        await context.assertActive();
        const result = await step(translate(...args));
        await context.assertActive();
        return result;
      }
    : undefined;
  const chatStreamFn = (_host, _model, prompt, options) =>
    remoteChatStream(context, prompt, options);
  let generator;
  if (payload.action === "summarize") {
    generator = summarizeText(
      {
        text: payload.content,
        title: payload.title,
        url: payload.url,
        mode: payload.mode || settings.responseFormat,
        type: payload.type,
        model,
        signal,
        language,
        customInstructions: settings.customInstructions,
        isSelection: payload.isSelection,
        focusKeyword: payload.focusKeyword,
      },
      {
        chatStreamFn,
        chunkTextFn: (text) => chunkBySections(text, context.chunkChars),
        translateFn,
        onProgress,
      },
    );
  } else {
    const content = await step(
      getRelevantContent(payload.content, payload.question),
    );
    await context.assertActive();
    const prompt = withCustomInstructions(
      buildAnswerPrompt(payload.title, payload.url, content, payload.question),
      settings.customInstructions,
    );
    generator = streamInTargetLanguage(
      (prompt, options) => remoteChatStream(context, prompt, options),
      prompt,
      language,
      { signal, translateFn },
    );
  }
  for await (const token of generator) {
    if (signal.aborted) await context.assertActive();
    yield token;
  }
  await context.assertActive();
}
