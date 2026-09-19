import {
  buildLanguageSystemPrompt,
  buildTranslatePrompt,
  resolveLanguageName,
} from "../summarize/prompts.js";
import {
  detectPrimaryLanguage,
  detectedMatchesTarget,
} from "./detectLanguage.js";
import { debugLog } from "../util/log.js";

export async function* streamInTargetLanguage(
  chatFn,
  prompt,
  language,
  {
    signal,
    detectLanguageFn = detectPrimaryLanguage,
    onFallback,
    translateFn,
  } = {},
) {
  const target = resolveLanguageName(language) ? language : null;
  if (!target) {
    yield* chatFn(prompt, { signal });
    return;
  }

  if (translateFn) {
    let out = "";
    for await (const token of chatFn(prompt, { signal })) out += token;
    if (signal?.aborted) return;
    out = out.trim();
    if (!out) {
      yield out;
      return;
    }
    const detected = await detectLanguageFn(out);
    if (detectedMatchesTarget(detected, target)) {
      yield out;
      return;
    }
    debugLog(
      `[i18n] translate fallback: detected=${detected} target=${target}`,
    );
    onFallback?.();
    const translated = await translateFn(out, target);
    if (translated != null) {
      yield translated;
      return;
    }
    yield* chatFn(buildTranslatePrompt(out, target), { signal });
    return;
  }

  let out = "";
  for await (const token of chatFn(prompt, {
    signal,
    system: buildLanguageSystemPrompt(target),
  })) {
    out += token;
  }
  if (signal?.aborted) return;
  out = out.trim();

  const detected = await detectLanguageFn(out);
  if (!out || detectedMatchesTarget(detected, target)) {
    yield out;
    return;
  }

  onFallback?.();
  yield* chatFn(buildTranslatePrompt(out, target), { signal });
}

export async function generateInTargetLanguage(chatFn, prompt, language, opts) {
  let out = "";
  for await (const token of streamInTargetLanguage(
    chatFn,
    prompt,
    language,
    opts,
  )) {
    out += token;
  }
  return out;
}
