// Stream cleanup uses the same inactivity window in the worker and offscreen document.

export const STREAM_CLEANUP_MS = 2 * 60 * 1000;
// Chrome (120+) clamps delayInMinutes/periodInMinutes below 0.5 to 30s with
// a warning; unpacked builds have no limit. Keep one shared floor here.
export const MIN_ALARM_DELAY_MINUTES = 0.5;

const defaultWarn =
  typeof console?.warn === "function" ? console.warn.bind(console) : undefined;

// Convert an ms delay to chrome.alarms minutes, clamping to minMinutes.
// Values below the floor (or non-finite/non-number input) return minMinutes.
// Pass warn: null/undefined/false to silence the clamp warning; any function
// receives the warning message. Runs silently on the in-range path; the worker
// passes warn: null because a short re-arm delay is expected.
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
  // Deadlines use elapsed time so system clock changes cannot move them.
  const timers = new Map();

  function cancel(id) {
    const timer = timers.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    timers.delete(id);
  }

  function arm(id, timer, delayMs) {
    timer.handle = setTimeout(() => {
      const remainingMs = timer.deadline - performance.now();
      if (remainingMs > 0) {
        arm(id, timer, remainingMs);
        return;
      }
      timers.delete(id);
      onExpire?.(id);
    }, delayMs);
    // Browsers return a number here, so this is a no-op in the extension.
    if (typeof timer.handle?.unref === "function") {
      try {
        timer.handle.unref();
      } catch {
        // unref is unavailable in some environments.
      }
    }
  }

  function schedule(id) {
    const deadline = performance.now() + timeoutMs;
    const pending = timers.get(id);
    if (pending) {
      // Let the existing timeout recheck the deadline to avoid timer churn.
      pending.deadline = deadline;
      return;
    }
    const timer = { deadline };
    timers.set(id, timer);
    arm(id, timer, timeoutMs);
  }

  return { schedule, cancel };
}
