import {
  broadcastToStream,
  disconnectStreamPorts,
  safeDisconnect,
  safePost,
} from "../lib/util/streamBroadcast.js";
import {
  msToAlarmMinutes,
  STREAM_CLEANUP_MS,
} from "../lib/util/streamExpiry.js";
import {
  OFFSCREEN_CALL_TIMEOUT_MS,
  OFFSCREEN_UNRESPONSIVE_ERROR_CODE,
} from "../lib/constants.js";
import { OFFSCREEN_UNRESPONSIVE_ERROR_MSG } from "../lib/util/messages.js";
import { UserFacingError } from "../lib/util/userError.js";
import { withTimeout } from "../lib/util/withTimeout.js";

// Stream registry and lifecycle: buffered local-HTTP streams, offscreen
// relay tracking, sliding expiry alarms, and the worker keep-alive. The
// service worker keeps message routing and engine-running; finalize.js and
// suggestQuestions.js import the registry and keep-alive from here. No
// imports from the worker, so the dependency direction stays one-way.
export const hasOffscreenAPI =
  typeof chrome !== "undefined" &&
  typeof chrome.offscreen !== "undefined" &&
  typeof chrome.offscreen.createDocument === "function";

// The popup waits on the worker, and the worker waits on the model document.
// A document that is alive but stuck (hung engine load, wedged GPU device)
// never answers, so without a cap the popup spins until the worker dies.
// withTimeout only stops the wait: generation already running in the
// document keeps going, so a retried call can queue behind it on the engine
// mutex until that work finishes.

// Offscreen calls currently awaiting a reply. has-active-streams only reports
// generation streams, so a long retrieve-context/find-passage (up to
// OFFSCREEN_WORK_TIMEOUT_MS) would otherwise look like an idle document and
// the idle close could shut it mid-call.
const offscreenCallsInflight = new Set();

export function hasOffscreenWorkInflight() {
  return offscreenCallsInflight.size > 0;
}

export function sendToOffscreen(
  message,
  timeoutMs = OFFSCREEN_CALL_TIMEOUT_MS,
) {
  const call = withTimeout(chrome.runtime.sendMessage(message), timeoutMs, {
    onTimeout: () => {
      const error = new UserFacingError(OFFSCREEN_UNRESPONSIVE_ERROR_MSG);
      error.code = OFFSCREEN_UNRESPONSIVE_ERROR_CODE;
      throw error;
    },
  });
  offscreenCallsInflight.add(call);
  const untrack = () => offscreenCallsInflight.delete(call);
  // Settle the tracker on both outcomes so it never outlives the call. This
  // derived promise always resolves, so it cannot surface an unhandled
  // rejection; the caller still gets the original (possibly rejecting) one.
  call.then(untrack, untrack);
  return call;
}

export function nextStreamId(kind) {
  return `${kind}-${crypto.randomUUID()}`;
}

export const activeStreams = new Map();

export const registeredStreamJobs = new Map();

// The finish handler saves once per stream. A duplicate late message for the
// same id must not rebuild the payload and save a second time (#628). Oldest
// entries fall out first, and real ids are UUIDs, so a new run never inherits
// another run's claim.
const MAX_FINISHED_STREAM_IDS = 100;
const finishedStreamIds = new Set();

export function claimStreamFinish(streamId) {
  if (!streamId) return true;
  if (finishedStreamIds.has(streamId)) return false;
  if (finishedStreamIds.size >= MAX_FINISHED_STREAM_IDS) {
    finishedStreamIds.delete(finishedStreamIds.values().next().value);
  }
  finishedStreamIds.add(streamId);
  return true;
}

export function registerStreamJob(streamId, jobData) {
  if (!streamId || !jobData?.finalize) return;
  // A fresh run may reuse an id in tests; give it its own single finish.
  finishedStreamIds.delete(streamId);
  registeredStreamJobs.set(streamId, jobData);
  scheduleStreamCleanup(streamId);
}

// WebLLM / Transformers jobs run in the offscreen document, so they have no
// entry in activeStreams above. Without explicit tracking the keep-alive
// below sees no work in flight, the worker sleeps ~30s into a multi-minute
// local generation, and the relay ports die: the popup freezes on its
// spinner while the offscreen job keeps running to completion (the full
// text only appears when the popup reopens and reads the saved view state).
// Entries live only while a popup is relayed to an offscreen stream; the
// headless finish path (stream-finished) needs no keep-alive because its
// message wakes the worker on arrival.
export const offscreenRelayInflight = new Map();
// A stream finishes once for all viewers, not once per relay. Track terminal
// state separately so a viewer closing before it sees the terminal message
// does not cancel work that another viewer already saw complete.
const offscreenTerminalStreams = new Set();

function forgetOffscreenRelay(streamId) {
  offscreenRelayInflight.delete(streamId);
  offscreenTerminalStreams.delete(streamId);
}

export function trackOffscreenRelay(streamId) {
  if (!streamId) return;
  offscreenTerminalStreams.delete(streamId);
  offscreenRelayInflight.set(
    streamId,
    (offscreenRelayInflight.get(streamId) || 0) + 1,
  );
  startKeepAlive();
}

export function untrackOffscreenRelay(streamId) {
  const count = offscreenRelayInflight.get(streamId);
  if (!count) {
    forgetOffscreenRelay(streamId);
    return false;
  }
  if (count > 1) {
    offscreenRelayInflight.set(streamId, count - 1);
    return false;
  }
  forgetOffscreenRelay(streamId);
  return true;
}

export function clearOffscreenRelayRefs(streamId) {
  if (!streamId) return;
  forgetOffscreenRelay(streamId);
}

// Fire-and-forget background jobs (suggest-questions, summary saves) with no
// live stream entry: tracked by key so the keep-alive below sees them as work
// in flight.
const backgroundJobsInflight = new Set();

export function trackBackgroundJob(key) {
  if (!key || backgroundJobsInflight.has(key)) return false;
  backgroundJobsInflight.add(key);
  startKeepAlive();
  return true;
}

export function untrackBackgroundJob(key) {
  backgroundJobsInflight.delete(key);
}

// A finished stream stops counting as work before its summary is written:
// finish() marks the stream done and the stream-finished handler clears its
// relay refs first. Track the save itself so the keep-alive cannot stop in
// the gap and let the worker sleep mid-save. The returned release function
// stops the tracking; null means there is no save id or another caller
// already tracks this save.
export function trackFinalizeJob(streamId) {
  if (!streamId) return null;
  const key = `finalize:${streamId}`;
  if (!trackBackgroundJob(key)) return null;
  return () => untrackBackgroundJob(key);
}

export function hasBackgroundJobsInflight() {
  return backgroundJobsInflight.size > 0;
}

export const STREAM_CLEANUP_PREFIX = "stream-cleanup:";
// Deadline per stream. The alarm is armed once and rechecks this map when it
// fires; progress only moves the deadline, so chunks never recreate it.
const streamCleanupDeadlines = new Map();

export function scheduleStreamCleanup(streamId) {
  const hasDeadline = streamCleanupDeadlines.has(streamId);
  streamCleanupDeadlines.set(streamId, performance.now() + STREAM_CLEANUP_MS);
  if (!hasDeadline) armStreamCleanupAlarm(streamId, STREAM_CLEANUP_MS);
}

// Test-only role: exposes the pending deadline so stream tests can assert
// that provider activity slides it without re-creating the browser alarm.
export function getStreamCleanupDeadline(streamId) {
  return streamCleanupDeadlines.get(streamId) ?? null;
}

function armStreamCleanupAlarm(streamId, delayMs) {
  chrome.alarms.create(STREAM_CLEANUP_PREFIX + streamId, {
    delayInMinutes: msToAlarmMinutes(delayMs, { warn: null }),
  });
}

export function handleStreamCleanupAlarm(streamId) {
  // Progress only moves the deadline. Re-arm here if the pending alarm
  // wakes before the stream has been idle for the full window.
  const remainingMs =
    (streamCleanupDeadlines.get(streamId) ?? 0) - performance.now();
  if (remainingMs > 0) {
    armStreamCleanupAlarm(streamId, remainingMs);
    return;
  }
  expireStreamForCleanup(streamId);
}

export const EXPIRED_STREAM_ERROR =
  "This response is no longer available (its stream expired). " +
  "Try summarizing again.";

export function expireStreamForCleanup(streamId) {
  streamCleanupDeadlines.delete(streamId);
  const stream = activeStreams.get(streamId);
  if (stream && !stream.done) {
    stream.controller?.abort();
    // Cleanup alarms run outside finish(), so mark terminal state here.
    stream.done = true;
    stream.error = EXPIRED_STREAM_ERROR;
    stream.errorUserFacing = true;
    broadcastToStream(stream, {
      type: "error",
      error: EXPIRED_STREAM_ERROR,
      userFacing: true,
    });
    disconnectStreamPorts(stream);
  }
  activeStreams.delete(streamId);
  // A slow model can still finish after the cleanup window. Keep the original
  // finalize payload (cache keys captured at run start) for a late finish
  // instead of letting the worker rebuild it from the current settings.
  const job = registeredStreamJobs.get(streamId);
  registeredStreamJobs.delete(streamId);
  if (job) retainExpiredStreamJob(streamId, job);
}

const EXPIRED_JOB_RETENTION_MS = 30 * 60 * 1000;
const MAX_EXPIRED_JOBS = 20;
const expiredStreamJobs = new Map();

function pruneExpiredStreamJobs(now = Date.now()) {
  for (const [id, entry] of expiredStreamJobs) {
    if (entry.expiresAt <= now) expiredStreamJobs.delete(id);
  }
  while (expiredStreamJobs.size > MAX_EXPIRED_JOBS) {
    expiredStreamJobs.delete(expiredStreamJobs.keys().next().value);
  }
}

function retainExpiredStreamJob(streamId, job) {
  expiredStreamJobs.set(streamId, {
    job,
    expiresAt: Date.now() + EXPIRED_JOB_RETENTION_MS,
  });
  pruneExpiredStreamJobs();
}

// Removes and returns the job retained for a stream whose cleanup window
// already elapsed, or null when none (or it aged out).
export function takeExpiredStreamJob(streamId) {
  pruneExpiredStreamJobs();
  const entry = expiredStreamJobs.get(streamId);
  if (!entry) return null;
  expiredStreamJobs.delete(streamId);
  return entry.job;
}

const KEEPALIVE_MS = 20000;
let keepAliveTimer = null;

export function hasWorkInFlight() {
  for (const stream of activeStreams.values()) {
    if (!stream.done) return true;
  }
  if (offscreenRelayInflight.size > 0) return true;
  if (offscreenCallsInflight.size > 0) return true;
  return hasBackgroundJobsInflight();
}

export function startKeepAlive() {
  if (keepAliveTimer !== null) return;
  keepAliveTimer = setInterval(() => {
    if (!hasWorkInFlight()) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      return;
    }
    try {
      chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
    } catch {
      // intent: best-effort, ignore if already closed/unavailable
    }
  }, KEEPALIVE_MS);
  // Node test runners hold the event loop for active intervals; browsers
  // return a number here so this is a no-op in the real worker.
  if (keepAliveTimer.unref) keepAliveTimer.unref();
}

export function isOffscreenStream(streamId) {
  return (
    hasOffscreenAPI &&
    (streamId.startsWith("webllm-") || streamId.startsWith("transformers-"))
  );
}

// Shared cancel forward: the explicit cancel-stream path and the relay
// popup-disconnect path abort the backing offscreen GPU/engine job the same
// way, so closing the last viewer cannot leave a detached generation running.
export function forwardCancelToOffscreen(streamId) {
  return chrome.runtime
    .sendMessage({
      target: "offscreen",
      action: "cancel-stream",
      payload: { streamId },
    })
    .catch(() => {});
}

export function relayToOffscreenStream(popupPort, streamId) {
  // A live viewer exists, so this offscreen job is work in flight: keep the
  // worker awake until the relay ends, otherwise it sleeps mid-generation
  // and the popup stalls on its spinner.
  const offscreenPort = chrome.runtime.connect({
    name: `offscreen-stream-${streamId}`,
  });
  trackOffscreenRelay(streamId);

  let terminal = false;
  let released = false;
  let disconnectHandled = false;
  const endRelay = () => {
    // A terminal message or either port disconnecting ends this relay.
    // Release only its own reference, so another viewer keeps the run alive.
    if (released) return;
    released = true;
    const streamTerminal = offscreenTerminalStreams.has(streamId);
    const lastRelay = untrackOffscreenRelay(streamId);
    if (!streamTerminal && lastRelay) {
      forwardCancelToOffscreen(streamId);
    }
  };

  offscreenPort.onMessage.addListener((msg) => {
    if (msg.type === "chunk") {
      // Heartbeat for relayed jobs: the offscreen document owns the text,
      // but the worker owns the registered-job/alarm entry, so progress seen
      // here must slide the same 2-min window.
      scheduleStreamCleanup(streamId);
    }
    if (
      msg.type === "done" ||
      msg.type === "error" ||
      msg.type === "cancelled"
    ) {
      terminal = true;
      offscreenTerminalStreams.add(streamId);
      endRelay();
    }
    safePost(popupPort, msg);
  });

  offscreenPort.onDisconnect.addListener(() => {
    if (disconnectHandled) return;
    disconnectHandled = true;
    endRelay();
    if (!terminal) {
      safePost(popupPort, {
        type: "error",
        error: "Connection to local model was lost",
      });
    }
    safeDisconnect(popupPort);
  });

  popupPort.onDisconnect.addListener(() => {
    if (disconnectHandled) return;
    disconnectHandled = true;
    endRelay();
    safeDisconnect(offscreenPort);
  });
}
