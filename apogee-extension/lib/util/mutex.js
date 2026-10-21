export class MutexTimeoutError extends Error {
  constructor(message = "Timed out waiting for lock") {
    super(message);
    this.name = "MutexTimeoutError";
  }
}

export class MutexAbortError extends Error {
  constructor(message = "Lock acquisition aborted") {
    super(message);
    this.name = "MutexAbortError";
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new MutexAbortError(
      signal.reason?.message || "Lock acquisition aborted",
    );
  }
}

// FIFO mutex. `acquire()` waits forever; pass `{ timeout, signal }` so a
// stalled holder cannot block later streams. Settled waiters leave the
// queue in order.
export function createLock() {
  let locked = false;
  const waiters = [];

  function pump() {
    if (locked) return;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter.settled) continue;
      waiter.settled = true;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      locked = true;
      waiter.resolve(makeRelease());
      return;
    }
  }

  function makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      locked = false;
      pump();
    };
  }

  async function acquire(options = {}) {
    const { timeout, signal } =
      typeof options === "number" ? { timeout: options } : (options ?? {});
    throwIfAborted(signal);
    if (timeout !== undefined) {
      if (typeof timeout !== "number" || !(timeout > 0)) {
        throw new TypeError("timeout must be a positive number of ms");
      }
    }

    if (!locked) {
      locked = true;
      return makeRelease();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        settled: false,
        signal,
        timer: null,
        onAbort: null,
      };

      const remove = () => {
        const idx = waiters.indexOf(waiter);
        if (idx !== -1) waiters.splice(idx, 1);
      };

      if (timeout !== undefined) {
        // Keep the event loop alive: callers await this timer.
        waiter.timer = setTimeout(() => {
          if (waiter.settled) return;
          waiter.settled = true;
          remove();
          signal?.removeEventListener("abort", waiter.onAbort);
          reject(
            new MutexTimeoutError(
              `Timed out after ${timeout}ms waiting for lock`,
            ),
          );
        }, timeout);
      }

      if (signal) {
        waiter.onAbort = () => {
          if (waiter.settled) return;
          waiter.settled = true;
          if (waiter.timer) clearTimeout(waiter.timer);
          remove();
          reject(
            new MutexAbortError(
              signal.reason?.message || "Lock acquisition aborted",
            ),
          );
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }

      waiters.push(waiter);
    });
  }

  acquire.tryAcquire = () => {
    if (locked) return null;
    locked = true;
    return makeRelease();
  };

  acquire.pendingCount = () => waiters.length;
  acquire.isLocked = () => locked;

  return acquire;
}

// Test-only role (#500): per-key FIFO locks, so one stalled engine/model does
// not block the rest. No live caller today - the product still takes one
// createLock() per context - but the test pins the per-engine isolation
// property this primitive exists for.
export function createKeyedLock() {
  const locks = new Map();

  function acquireFor(key, options) {
    let lock = locks.get(key);
    if (!lock) {
      lock = createLock();
      locks.set(key, lock);
    }
    return lock(options);
  }

  acquireFor.tryAcquire = (key) => {
    let lock = locks.get(key);
    if (!lock) {
      lock = createLock();
      locks.set(key, lock);
    }
    return lock.tryAcquire();
  };

  acquireFor.pendingCount = (key) => locks.get(key)?.pendingCount() ?? 0;
  acquireFor.isLocked = (key) => locks.get(key)?.isLocked() ?? false;
  acquireFor.keys = () => [...locks.keys()];
  acquireFor.forget = (key) => {
    const lock = locks.get(key);
    if (lock && !lock.isLocked() && lock.pendingCount() === 0) {
      locks.delete(key);
    }
  };

  return acquireFor;
}
