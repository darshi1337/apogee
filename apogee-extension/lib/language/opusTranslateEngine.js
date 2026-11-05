import {
  withTranslator,
  translateBatch,
} from "../engines/transformersEngine.js";
import { detectPrimaryLanguage } from "./detectLanguage.js";
import {
  resolveOpusModel,
  translatePreservingStructure,
} from "./opusTranslate.js";
import { TRANSLATION_ENGINES } from "../constants.js";

// Shared OPUS gate used by the offscreen document and the service worker:
// any other engine needs no translator, so callers get undefined. Without
// an onProgress callback the translator runs silent.
export function opusTranslateFnFor(translationEngine, onProgress) {
  if (translationEngine !== TRANSLATION_ENGINES.OPUS) return undefined;
  const reportProgress = onProgress ?? (() => {});
  return async (text, targetLang) => {
    const detected = await detectPrimaryLanguage(text);
    const src = (detected || "en").toLowerCase().split("-")[0];
    const resolved = resolveOpusModel(src, targetLang);
    if (!resolved) return null;
    try {
      return await withTranslator(
        resolved.model,
        (progress) => reportProgress({ ...progress, kind: "download" }),
        (t) =>
          translatePreservingStructure(
            text,
            (lines) => translateBatch(t, lines, resolved.token),
            {
              onProgress: (done, total) =>
                reportProgress({
                  progress: total ? done / total : 1,
                  text: `Translating ${done}/${total}...`,
                }),
            },
          ),
      );
    } catch {
      return null;
    }
  };
}
