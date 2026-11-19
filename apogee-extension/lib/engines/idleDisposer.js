// Schedules teardown for a cached engine after it goes idle.
//
// One timer and one generation counter per engine. A stale timer can never
// tear down an engine that a newer run reused. Teardown acquires the engine
// lock first, so it also cannot race an active stream.
export function createIdleDisposer({
  idleMs,
  acquireLock,
  lockTimeoutMs,
  dispose,
  onError = () => {},
}) {
  let timer = null;
  let generation = 0;

  function cancel() {
    generation++;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule() {
    cancel();

    const mine = generation;
    timer = setTimeout(async () => {
      timer = null;
      let release;

      try {
        release = await acquireLock({ timeout: lockTimeoutMs });
        // A newer run may have cancelled this timer while it waited.
        if (mine !== generation) return;
        await dispose();
      } catch (err) {
        onError(err);
        // The engine survived, so try again after another idle window.
        if (mine === generation) schedule();
      } finally {
        release?.();
      }
    }, idleMs);

    if (timer.unref) timer.unref();
  }

  return {
    cancel,
    schedule,
    isScheduled: () => timer !== null,
  };
}
