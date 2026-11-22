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

function normalizeOptions(options) {
  const { timeout, signal } =
    typeof options === "number" ? { timeout: options } : (options ?? {});
  if (timeout !== undefined) {
    if (typeof timeout !== "number" || !(timeout > 0)) {
      throw new TypeError("timeout must be a positive number of ms");
    }
  }
  return { timeout, signal };
}

// FIFO mutex. `acquire()` waits forever; pass `{ timeout, signal }` so a
// stalled holder cannot block later streams. Settled waiters leave the
// queue in order.
function createLocalLock() {
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
    const { timeout, signal } = normalizeOptions(options);
    throwIfAborted(signal);

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

// A named lock also takes a Web Lock, which the browser shares across the
// popup, the service worker, and the offscreen document. A lock without a
// name stays inside one JavaScript heap.
function acquireWebLock(name, { timeout, signal }) {
  return new Promise((resolve, reject) => {
    let releaseHold;
    const hold = new Promise((done) => {
      releaseHold = done;
    });
    const controller = new AbortController();
    let timer = null;
    let onAbort = null;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      onAbort = null;
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort();
      releaseHold();
      reject(err);
    };

    if (timeout !== undefined) {
      timer = setTimeout(() => {
        fail(
          new MutexTimeoutError(
            `Timed out after ${timeout}ms waiting for lock`,
          ),
        );
      }, timeout);
    }
    if (signal) {
      onAbort = () => {
        fail(
          new MutexAbortError(
            signal.reason?.message || "Lock acquisition aborted",
          ),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }

    let request;
    try {
      request = globalThis.navigator.locks.request(
        name,
        { signal: controller.signal },
        async () => {
          if (settled) return;
          settled = true;
          cleanup();
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            releaseHold();
          });
          await hold;
        },
      );
    } catch (err) {
      fail(err);
      return;
    }
    request.catch((err) => fail(err));
  });
}

function createCrossContextLock(name, local) {
  const acquire = async (options = {}) => {
    const { timeout, signal } = normalizeOptions(options);
    throwIfAborted(signal);
    const deadline = timeout === undefined ? null : Date.now() + timeout;
    const releaseLocal = await local({ timeout, signal });
    try {
      const remaining = deadline === null ? undefined : deadline - Date.now();
      if (remaining !== undefined && remaining <= 0) {
        throw new MutexTimeoutError(
          `Timed out after ${timeout}ms waiting for lock`,
        );
      }
      const releaseWeb = await acquireWebLock(name, {
        timeout: remaining,
        signal,
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releaseWeb();
        releaseLocal();
      };
    } catch (err) {
      releaseLocal();
      throw err;
    }
  };

  // tryAcquire cannot see another context synchronously, so it never grants.
  acquire.tryAcquire = () => null;
  acquire.pendingCount = () => local.pendingCount();
  acquire.isLocked = () => local.isLocked();
  return acquire;
}

// Pass a name to serialize same-origin contexts through the Web Locks API,
// with a local FIFO lock in front so one context still queues in order. Without
// a name (or without Web Locks), the lock stays local to this heap.
export function createLock(options = {}) {
  const name = typeof options === "string" ? options : options?.name;
  const local = createLocalLock();
  const locks = globalThis.navigator?.locks;
  if (typeof name !== "string" || !name || !locks?.request) return local;
  return createCrossContextLock(name, local);
}

// Test-only role (#500): per-key FIFO locks, so one stalled engine/model does
// not block the rest. No live caller today - engine locks still take one
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
