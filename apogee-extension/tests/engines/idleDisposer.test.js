import test from "node:test";
import assert from "node:assert/strict";
import { createIdleDisposer } from "../../lib/engines/idleDisposer.js";

function fakeLock() {
  let held = false;
  const state = { acquisitions: 0, releases: 0, held: false };

  function acquireLock() {
    assert.equal(held, false, "lock acquired while already held");
    held = true;
    state.held = true;
    state.acquisitions++;
    return () => {
      assert.equal(held, true, "released a lock that was not held");
      held = false;
      state.held = false;
      state.releases++;
    };
  }

  return { acquireLock, state };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function makeDisposer(lock, dispose, extra = {}) {
  return createIdleDisposer({
    idleMs: 1000,
    acquireLock: lock.acquireLock,
    lockTimeoutMs: 5000,
    dispose,
    ...extra,
  });
}

test("disposes after the idle window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const lock = fakeLock();
  let disposed = 0;

  const idle = makeDisposer(lock, async () => {
    disposed++;
    assert.equal(lock.state.held, true, "dispose runs under the lock");
  });

  idle.schedule();
  assert.equal(idle.isScheduled(), true);

  t.mock.timers.tick(999);
  await flush();
  assert.equal(disposed, 0);

  t.mock.timers.tick(1);
  await flush();
  assert.equal(disposed, 1);
  assert.equal(idle.isScheduled(), false);
  assert.equal(lock.state.releases, 1);
  assert.equal(lock.state.held, false);
});

test("cancel prevents disposal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const lock = fakeLock();
  let disposed = 0;

  const idle = makeDisposer(lock, async () => {
    disposed++;
  });

  idle.schedule();
  idle.cancel();
  assert.equal(idle.isScheduled(), false);

  t.mock.timers.tick(60 * 1000);
  await flush();
  assert.equal(disposed, 0);
  assert.equal(lock.state.acquisitions, 0);
});

test("scheduling again restarts the idle window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const lock = fakeLock();
  let disposed = 0;

  const idle = makeDisposer(lock, async () => {
    disposed++;
  });

  idle.schedule();
  t.mock.timers.tick(600);
  idle.schedule();

  // The first timer must not fire after the new window starts.
  t.mock.timers.tick(600);
  await flush();
  assert.equal(disposed, 0);

  t.mock.timers.tick(400);
  await flush();
  assert.equal(disposed, 1);
});

test("a cancelled timer waiting for the lock does not dispose", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveAcquire;
  let disposed = 0;

  const idle = createIdleDisposer({
    idleMs: 1000,
    acquireLock: () =>
      new Promise((resolve) => {
        resolveAcquire = resolve;
      }),
    lockTimeoutMs: 5000,
    dispose: async () => {
      disposed++;
    },
  });

  idle.schedule();
  t.mock.timers.tick(1000);
  await flush();

  // A new run cancels the timer while it is waiting for the lock.
  idle.schedule();
  resolveAcquire(() => {});
  await flush();
  assert.equal(disposed, 0, "stale timer must not dispose the engine");

  t.mock.timers.tick(1000);
  await flush();
  resolveAcquire(() => {});
  await flush();
  assert.equal(disposed, 1);
});

test("retries after the lock cannot be acquired", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  let disposed = 0;
  let errors = 0;

  const idle = createIdleDisposer({
    idleMs: 1000,
    acquireLock: async () => {
      attempts++;
      if (attempts === 1) throw new Error("lock timeout");
      return () => {};
    },
    lockTimeoutMs: 10,
    dispose: async () => {
      disposed++;
    },
    onError: () => {
      errors++;
    },
  });

  idle.schedule();
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(errors, 1);
  assert.equal(disposed, 0);
  assert.equal(idle.isScheduled(), true);

  t.mock.timers.tick(1000);
  await flush();
  assert.equal(attempts, 2);
  assert.equal(disposed, 1);
  assert.equal(idle.isScheduled(), false);
});
