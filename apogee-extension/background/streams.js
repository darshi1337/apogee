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

// Stream registry and lifecycle: buffered local-HTTP streams, offscreen
// relay tracking, sliding expiry alarms, and the worker keep-alive. The
// service worker keeps message routing and engine-running; finalize.js and
// suggestQuestions.js import the registry and keep-alive from here. No
// imports from the worker, so the dependency direction stays one-way.
export const hasOffscreenAPI =
  typeof chrome !== "undefined" &&
  typeof chrome.offscreen !== "undefined" &&
  typeof chrome.offscreen.createDocument === "function";

export function nextStreamId(kind) {
  return `${kind}-${crypto.randomUUID()}`;
}

export const activeStreams = new Map();

export const registeredStreamJobs = new Map();

export function registerStreamJob(streamId, jobData) {
  if (!streamId || !jobData?.finalize) return;
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
export const offscreenRelayInflight = new Set();

export function trackOffscreenRelay(streamId) {
  if (!streamId) return;
  offscreenRelayInflight.add(streamId);
  startKeepAlive();
}

export function untrackOffscreenRelay(streamId) {
  offscreenRelayInflight.delete(streamId);
}

// Fire-and-forget background jobs (suggest-questions) with no stream entry:
// tracked by key so the keep-alive below sees them as work in flight.
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

export function hasBackgroundJobsInflight() {
  return backgroundJobsInflight.size > 0;
}

export const STREAM_CLEANUP_PREFIX = "stream-cleanup:";
// Single source of truth for the 2-min window lives in lib/util/streamExpiry.js
// (the offscreen document consumes it as ms); alarms take minutes.
const STREAM_CLEANUP_MINUTES = msToAlarmMinutes(STREAM_CLEANUP_MS);
// Sliding expiry: re-creating an alarm with the same name overwrites it, so
// every call pushes expiry 2 min out. Callers refresh on each chunk of
// progress (emitChunk, relayed offscreen chunks); a stream with no progress
// for the full window is reclaimed by the alarm handler below.
export function scheduleStreamCleanup(streamId) {
  chrome.alarms.create(`${STREAM_CLEANUP_PREFIX}${streamId}`, {
    delayInMinutes: STREAM_CLEANUP_MINUTES,
  });
}

export const EXPIRED_STREAM_ERROR =
  "This response is no longer available (its stream expired). " +
  "Try summarizing again.";

export function expireStreamForCleanup(streamId) {
  const stream = activeStreams.get(streamId);
  if (stream && !stream.done) {
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
  registeredStreamJobs.delete(streamId);
}

const KEEPALIVE_MS = 20000;
let keepAliveTimer = null;

export function hasWorkInFlight() {
  for (const stream of activeStreams.values()) {
    if (!stream.done) return true;
  }
  if (offscreenRelayInflight.size > 0) return true;
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
// way, so a closed popup cannot leave a detached generation running.
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
  trackOffscreenRelay(streamId);
  const offscreenPort = chrome.runtime.connect({
    name: `offscreen-stream-${streamId}`,
  });

  let terminal = false;

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
      untrackOffscreenRelay(streamId);
    }
    safePost(popupPort, msg);
  });

  offscreenPort.onDisconnect.addListener(() => {
    untrackOffscreenRelay(streamId);
    if (!terminal) {
      safePost(popupPort, {
        type: "error",
        error: "Connection to local model was lost",
      });
    }
    safeDisconnect(popupPort);
  });

  popupPort.onDisconnect.addListener(() => {
    untrackOffscreenRelay(streamId);
    // The offscreen port's own onDisconnect only drops the subscriber — a
    // closed popup must also stop the backing job (guarded by !terminal so
    // a finished stream isn't touched).
    if (!terminal) {
      forwardCancelToOffscreen(streamId);
    }
    safeDisconnect(offscreenPort);
  });
}
