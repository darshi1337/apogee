import test from "node:test";
import assert from "node:assert";
import {
  createLock,
  createKeyedLock,
  MutexAbortError,
  MutexTimeoutError,
} from "../../lib/util/mutex.js";

test("acquire and release: a second acquire resolves after the first is released", async () => {
  const acquire = createLock();
  const release1 = await acquire();
  release1();
  const release2 = await acquire();
  release2();
});

test("waiting: second caller does not proceed until first releases", async () => {
  const acquire = createLock();
  const order = [];

  const release1 = await acquire();
  order.push("enter-1");

  const second = acquire().then((release2) => {
    order.push("enter-2");
    release2();
  });

  // Second caller hasn't entered yet because we still hold the lock.
  await Promise.resolve();
  assert.deepStrictEqual(order, ["enter-1"]);

  order.push("exit-1");
  release1();

  await second;
  assert.deepStrictEqual(order, ["enter-1", "exit-1", "enter-2"]);
});

test("try/finally: if the critical section throws, next caller still gets the lock", async () => {
  const acquire = createLock();
  const order = [];

  // First caller throws inside the critical section but releases in finally.
  try {
    const release = await acquire();
    try {
      order.push("enter-1");
      throw new Error("boom");
    } finally {
      release();
    }
  } catch {
    order.push("threw-1");
  }

  // Second caller should still be able to acquire.
  const release2 = await acquire();
  order.push("enter-2");
  release2();

  assert.deepStrictEqual(order, ["enter-1", "threw-1", "enter-2"]);
});

test("ordering: multiple waiters are served in FIFO order", async () => {
  const acquire = createLock();
  const order = [];

  const release1 = await acquire();

  const p2 = acquire().then((release) => {
    order.push("2");
    release();
  });
  const p3 = acquire().then((release) => {
    order.push("3");
    release();
  });
  const p4 = acquire().then((release) => {
    order.push("4");
    release();
  });

  release1();
  await Promise.all([p2, p3, p4]);

  assert.deepStrictEqual(order, ["2", "3", "4"]);
});

test("contention/timeout: a stalled holder does not block waiters forever", async () => {
  const acquire = createLock();
  const release1 = await acquire();

  // Second waiter gives up after 20ms instead of hanging forever behind the
  // stalled model download.
  await assert.rejects(acquire({ timeout: 20 }), MutexTimeoutError);

  // The timed-out waiter left the queue: the next waiter still gets the lock
  // in order once the holder releases.
  const order = [];
  const p3 = acquire({ timeout: 1000 }).then((release) => {
    order.push("3");
    release();
  });
  release1();
  await p3;
  assert.deepStrictEqual(order, ["3"]);
});

test("contention/timeout: queue keeps FIFO order after a timeout", async () => {
  const acquire = createLock();
  const release1 = await acquire();

  const order = [];
  const pTimeout = acquire({ timeout: 20 }).then(
    () => order.push("timeout-acquired-unexpectedly"),
    (err) => {
      assert.ok(err instanceof MutexTimeoutError);
      order.push("timed-out");
    },
  );
  const pNext = acquire({ timeout: 1000 }).then((release) => {
    order.push("next");
    release();
  });

  await pTimeout;
  assert.deepStrictEqual(order, ["timed-out"]);
  assert.strictEqual(acquire.pendingCount(), 1);

  release1();
  await pNext;
  assert.deepStrictEqual(order, ["timed-out", "next"]);
});

test("abort: a cancelled stream stops waiting for the lock", async () => {
  const acquire = createLock();
  const release1 = await acquire();

  const controller = new AbortController();
  const waiting = acquire({ signal: controller.signal }).then(
    () => "acquired-unexpectedly",
    (err) => err,
  );
  controller.abort();
  const err = await waiting;
  assert.ok(err instanceof MutexAbortError);

  // The aborted waiter left the queue.
  assert.strictEqual(acquire.pendingCount(), 0);
  release1();
  const release2 = await acquire({ timeout: 100 });
  release2();
});

test("abort: already-aborted signal never acquires", async () => {
  const acquire = createLock();
  const release1 = await acquire();
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      acquire({ signal: controller.signal }),
      MutexAbortError,
    );
  } finally {
    release1();
  }
});

test("keyed: a stalled engine does not block a different engine", async () => {
  const acquire = createKeyedLock();
  const releaseA = await acquire("webllm");

  // Same key waits; different key proceeds immediately.
  let sameKeyAcquired = false;
  const sameKey = acquire("webllm", { timeout: 1000 }).then((release) => {
    sameKeyAcquired = true;
    release();
  });
  const releaseB = await acquire("transformers", { timeout: 50 });
  releaseB();

  assert.strictEqual(sameKeyAcquired, false);
  releaseA();
  await sameKey;
  assert.strictEqual(sameKeyAcquired, true);
});
