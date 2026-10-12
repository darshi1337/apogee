// Sliding expiry for buffered streams: each chunk reschedules a full
// window out, so active streams survive while idle ones are reclaimed.
// setTimeout only, so offscreen and unit tests share it; the worker
// mirrors it with chrome.alarms.

export const STREAM_CLEANUP_MS = 2 * 60 * 1000;
// Chrome (120+) clamps delayInMinutes/periodInMinutes below 0.5 to 30s with
// a warning; unpacked builds have no limit. Keep one shared floor here.
export const MIN_ALARM_DELAY_MINUTES = 0.5;

const defaultWarn =
  typeof console?.warn === "function" ? console.warn.bind(console) : undefined;

// Convert an ms delay to chrome.alarms minutes, clamping to minMinutes.
// Values below the floor (or non-finite/non-number input) return minMinutes.
// Pass warn: null/undefined/false to silence the clamp warning; any function
// receives the warning message. Runs silently on the in-range path, so the
// service worker can call it once at module load without noise.
export function msToAlarmMinutes(
  ms,
  { minMinutes = MIN_ALARM_DELAY_MINUTES, warn = defaultWarn } = {},
) {
  const floor =
    typeof minMinutes === "number" && Number.isFinite(minMinutes)
      ? minMinutes
      : MIN_ALARM_DELAY_MINUTES;
  const isFiniteNumber = typeof ms === "number" && Number.isFinite(ms);
  const minutes = isFiniteNumber ? ms / (60 * 1000) : NaN;
  if (!isFiniteNumber || minutes < floor) {
    if (typeof warn === "function") {
      warn(
        `[apogee] Stream cleanup delay of ${ms}ms (${minutes} min) is below the minimum alarm delay of ${floor} min; clamping to ${floor} min.`,
      );
    }
    return floor;
  }
  return minutes;
}

export function createSlidingExpiry({
  timeoutMs = STREAM_CLEANUP_MS,
  onExpire,
} = {}) {
  const timers = new Map();

  function cancel(id) {
    const handle = timers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.delete(id);
    }
  }

  function schedule(id) {
    cancel(id);
    const handle = setTimeout(() => {
      timers.delete(id);
      onExpire?.(id);
    }, timeoutMs);
    // Browsers return a number here, so this is a no-op in the extension.
    if (typeof handle?.unref === "function") {
      try {
        handle.unref();
      } catch {
        // unref is unavailable in some environments.
      }
    }
    timers.set(id, handle);
  }

  return { schedule, cancel };
}
