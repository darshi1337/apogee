import {
  toUserMessage,
  UserFacingError,
  formatNotificationMessage,
} from "../lib/util/userError.js";
import { errorHelpUrl } from "../lib/util/errorHelp.js";
import { getSettings } from "../lib/storage/settings.js";
import { NotificationTargetManager } from "../lib/util/notificationTargets.js";
import {
  asFocusKeyword,
  getPromptsCacheKeyForSettings,
  getSummaryCacheKeyForSettings,
  hashUrl,
  persistSummaryIfAllowed,
  shouldPersist,
  isPrivateUrl,
} from "../lib/storage/pageCache.js";
import { saveViewStateIfJobMatches } from "../lib/storage/viewState.js";
import {
  getProviderType,
  getModelForSettings,
} from "../lib/engines/providers.js";
import { MAX_FINALIZE_TEXT_CHARS } from "../lib/extract/fileLimits.js";
import { broadcastToStream } from "../lib/util/streamBroadcast.js";
import { activeStreams, registerStreamJob } from "./streams.js";
import { runSuggestQuestionsJob } from "./suggestQuestions.js";

// Finalize path: trust-boundary rebuild of job metadata, persistence of
// finished summaries, completion/failure notification, and the preserved
// text retry store. The service worker keeps routing and engine-running;
// stream registry comes from streams.js, follow-up questions from
// suggestQuestions.js. No imports from the worker.

// Summaries that finished generating but could not be persisted (e.g. storage
// quota). Kept in memory so the text survives for a retry even when every
// storage write is rejecting. Bounded by count and age via
// NotificationTargetManager so a quota-stuck browser cannot grow it without
// limit; expiry is lazy on preserve/take.
const MAX_PENDING_FINALIZE_RETRIES = 10;
const MAX_PENDING_FINALIZE_AGE_MS = 5 * 60 * 1000;
export const pendingFinalizeRetries = new NotificationTargetManager({
  ttlMs: MAX_PENDING_FINALIZE_AGE_MS,
  maxCapacity: MAX_PENDING_FINALIZE_RETRIES,
});

export function preservePendingFinalize(
  { finalize, model, title, url, text },
  now = Date.now(),
) {
  const jobId = finalize?.jobId || finalize?.cacheKey || `${now}`;
  pendingFinalizeRetries.set(jobId, { finalize, model, title, url, text }, now);
  return jobId;
}

export function takePendingFinalize(jobId, now = Date.now()) {
  return pendingFinalizeRetries.take(jobId, now);
}

export const FINALIZE_FAILED_MESSAGE =
  "Couldn't save this summary (storage unavailable). The text above is preserved — try summarizing again.";

export const notificationTargets = new NotificationTargetManager();

export function notifyJobFailed(err) {
  console.error("Background summarize failed:", err);
  if (typeof chrome.notifications === "undefined") return;
  const message = toUserMessage(err);
  const notificationId = `apogee-summary-error-${crypto.randomUUID()}`;
  // A notification body cannot hold a link, so clicking it opens the explanation instead of focusing the tab.
  notificationTargets.set(notificationId, { helpUrl: errorHelpUrl(message) });
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-96.png"),
    title: "Summarize failed",
    message: formatNotificationMessage(
      message,
      " Click to see what this means.",
    ),
  });
}

export function notifyFinalizeFailure({ finalize, error, streamId }) {
  console.error("Failed to finalize summary:", error);
  const jobId = finalize?.jobId || null;
  const promptsCacheKey = finalize?.promptsCacheKey || null;
  const stream = streamId ? activeStreams.get(streamId) : null;
  if (stream) {
    try {
      broadcastToStream(stream, {
        type: "error",
        error: FINALIZE_FAILED_MESSAGE,
        userFacing: true,
        finalizeFailed: true,
        jobId,
        promptsCacheKey,
      });
    } catch {
      // intent: best-effort, ignore if already closed/unavailable
    }
  }
  try {
    chrome.runtime
      .sendMessage({
        type: "finalize-failed",
        jobId,
        promptsCacheKey,
        error: FINALIZE_FAILED_MESSAGE,
      })
      .catch(() => {});
  } catch {
    // intent: best-effort, ignore if already closed/unavailable
  }
  if (finalize?.notifyOnFinish) {
    try {
      notifyJobFailed(new UserFacingError(FINALIZE_FAILED_MESSAGE));
    } catch {
      // intent: best-effort, ignore if already closed/unavailable
    }
  } else if (!stream) {
    // No popup stream to show the banner and no completion notification
    // requested: the notification is the only user-visible surface left.
    // Background-initiated summaries always set notifyOnFinish, so this only
    // fires for popup flows whose stream already went away.
    try {
      chrome.runtime
        .sendMessage({
          type: "model-progress",
          progress: { progress: 0, text: FINALIZE_FAILED_MESSAGE },
        })
        .catch(() => {});
    } catch {
      // intent: best-effort, ignore if already closed/unavailable
    }
  }
}

export function notifyJobComplete({ title, tabId, windowId }) {
  if (typeof chrome.notifications === "undefined") return;
  const notificationId = `apogee-summary-${crypto.randomUUID()}`;
  notificationTargets.set(notificationId, { tabId, windowId });
  const rawMsg = title ? `"${title}" is ready to view.` : "Click to view it.";
  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-96.png"),
    title: "Summary ready",
    message: formatNotificationMessage(rawMsg, ""),
  });
}

export async function buildTrustedFinalize(payload) {
  if (!payload || typeof payload !== "object") return null;

  const rawFinalize = payload.finalize || {};
  const customContent = rawFinalize.customContent === true;
  const rawUrl =
    typeof payload.url === "string"
      ? payload.url
      : typeof rawFinalize.persistUrl === "string"
        ? rawFinalize.persistUrl
        : "";
  if (!rawUrl && !customContent) return null;

  const settings = await getSettings();
  const model = payload.model || getModelForSettings(settings);
  const providerType = getProviderType(settings);
  const isSelection = Boolean(rawFinalize.isSelection);
  const cacheUrl = isSelection
    ? `${rawUrl}#apogee-selection`
    : rawUrl || `local:${await hashUrl(payload.content || "")}`;

  const cacheKey = await getSummaryCacheKeyForSettings(
    cacheUrl,
    settings,
    model,
    asFocusKeyword(payload.focusKeyword),
  );
  const promptsCacheKey = await getPromptsCacheKeyForSettings(
    cacheUrl,
    settings,
    model,
    asFocusKeyword(payload.focusKeyword),
  );

  const persist = isSelection ? false : await shouldPersist(rawUrl);

  const jobId =
    typeof rawFinalize.jobId === "string" && rawFinalize.jobId
      ? rawFinalize.jobId
      : `summary-${crypto.randomUUID()}`;

  const tabId =
    typeof rawFinalize.tabId === "number" ? rawFinalize.tabId : null;
  const windowId =
    typeof rawFinalize.windowId === "number" ? rawFinalize.windowId : null;
  const notifyOnFinish = Boolean(rawFinalize.notifyOnFinish);
  const sensitive = await isPrivateUrl(rawUrl, settings);

  return {
    cacheKey,
    promptsCacheKey,
    persist,
    persistUrl: rawUrl,
    isSelection,
    customContent,
    providerType,
    host: settings.ollamaHost,
    notifyOnFinish,
    sensitive,
    tabId,
    jobId,
    windowId,
    language: settings.summaryLanguage,
    translationEngine: settings.translationEngine,
  };
}

export async function recordPopupSummaryStream(payload, streamId) {
  const finalize = payload?.finalize;
  if (!finalize?.jobId || finalize.tabId == null) return;
  registerStreamJob(streamId, {
    finalize,
    model: payload.model,
    title: payload.title,
    url: payload.url,
  });
  await saveViewStateIfJobMatches(
    finalize.tabId,
    finalize.jobId,
    {
      streamId,
      promptsCacheKey: finalize.promptsCacheKey,
      summaryLanguage: finalize.language,
      translationEngine: finalize.translationEngine,
    },
    "summarizing",
  );
}

export async function finalizeSummaryJob(
  { finalize, model, title, url, text, streamId = null },
  { ensureOffscreenDocument } = {},
) {
  if (!finalize) return { ok: true, persisted: false };
  // stream-finished text arrives via extension messaging and fans out into
  // cache/history/view-state: bound it at the trust boundary before use.
  if (typeof text === "string" && text.length > MAX_FINALIZE_TEXT_CHARS) {
    text =
      `${text.slice(0, MAX_FINALIZE_TEXT_CHARS).trim()}\n\n` +
      `[...summary truncated to the first ${MAX_FINALIZE_TEXT_CHARS} characters...]`;
  }
  const {
    cacheKey,
    promptsCacheKey,
    persist,
    persistUrl,
    isSelection,
    providerType,
    host,
    notifyOnFinish,
    sensitive,
    tabId,
    jobId,
    windowId,
    language,
    translationEngine,
  } = finalize;

  try {
    // `persist` is what was true when the job started. The write only happens if it is still true now, so turning history off mid-generation also excludes the summary that is running.
    const persisted =
      persist &&
      (await persistSummaryIfAllowed(
        persistUrl || url,
        cacheKey,
        promptsCacheKey,
        text,
        title,
      ));

    if (persisted || isSelection) {
      await saveViewStateIfJobMatches(
        tabId,
        jobId,
        {
          view: "summaryView",
          subview: "summary",
          url: persistUrl || url,
          streamId: null,
          summaryText: text,
          promptsCacheKey,
          summaryLanguage: language,
          translationEngine,
        },
        "summarizing",
      );
    }
    runSuggestQuestionsJob(
      {
        promptsCacheKey,
        persist: persisted,
        persistUrl: persistUrl || url,
        providerType,
        host,
        title,
        url,
        summary: text,
        model,
        language,
        translationEngine,
      },
      { ensureOffscreenDocument },
    ).catch((err) => console.error("Suggest-questions job failed:", err));
    if (notifyOnFinish) {
      notifyJobComplete({ title: sensitive ? "" : title, tabId, windowId });
    }
    return { ok: true, persisted: !!persisted };
  } catch (err) {
    preservePendingFinalize({ finalize, model, title, url, text });
    notifyFinalizeFailure({ finalize, title, error: err, streamId });
    return { ok: false, error: err };
  }
}
