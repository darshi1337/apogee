import test from "node:test";
import assert from "node:assert";
import * as transformersEngine from "../../lib/engines/transformersEngine.js";
import {
  isTransientLoadError,
  isEngineCorruptingError,
  withTranslator,
  disposeTranslatorNow,
  getTranslatorStatus,
  __setTranslatorForTest,
  disposeEngineNow,
  getEngineStatus,
  __setEngineForTest,
  withTransformersEngine,
} from "../../lib/engines/transformersEngine.js";
import { TRANSFORMERS_MODELS } from "../../lib/constants.js";

const MODEL_ID = TRANSFORMERS_MODELS[0].id;

test("engine lock timeout stays module-local (#499)", () => {
  assert.equal("ENGINE_LOCK_TIMEOUT_MS" in transformersEngine, false);
});

test("transient load errors are retried; corrupting errors are not transient", () => {
  assert.equal(
    isTransientLoadError(new Error("network error: failed to fetch")),
    true,
  );
  assert.equal(isTransientLoadError(new Error("cache.add failed")), true);
  assert.equal(isTransientLoadError(new Error("out of memory")), false);
  assert.equal(isTransientLoadError(new Error("boom")), false);
});

test("only corrupting errors discard the engine", () => {
  assert.equal(isEngineCorruptingError(new Error("out of memory")), true);
  assert.equal(
    isEngineCorruptingError(new Error("OOM while allocating GPUBuffer")),
    true,
  );
  assert.equal(
    isEngineCorruptingError(new Error("network error: failed to fetch")),
    false,
  );
  assert.equal(isEngineCorruptingError(new Error("boom")), false);
});

test("withTranslator keeps the cached translator on a transient failure", async (t) => {
  t.after(() => disposeTranslatorNow());
  let disposed = 0;
  const fake = {
    dispose: async () => {
      disposed++;
    },
  };
  __setTranslatorForTest(fake, "opus-mt-en-fr");

  await assert.rejects(
    withTranslator("opus-mt-en-fr", null, async () => {
      throw new Error("network error: failed to fetch");
    }),
    /network error/,
  );

  // Healthy engine kept: no reload needed for the next stream.
  assert.strictEqual(disposed, 0);
  assert.strictEqual(getTranslatorStatus().currentModelId, "opus-mt-en-fr");
});

test("withTranslator drops the cached translator on a corrupting failure", async (t) => {
  t.after(() => disposeTranslatorNow());
  let disposed = 0;
  const fake = {
    dispose: async () => {
      disposed++;
    },
  };
  __setTranslatorForTest(fake, "opus-mt-en-fr");

  await assert.rejects(
    withTranslator("opus-mt-en-fr", null, async () => {
      throw new Error("out of memory");
    }),
    /out of memory/,
  );

  assert.strictEqual(disposed, 1);
  assert.strictEqual(getTranslatorStatus().currentModelId, null);
});

test("idle translator is disposed instead of contending WASM memory", async () => {
  let disposed = 0;
  const fake = {
    dispose: async () => {
      disposed++;
    },
  };
  __setTranslatorForTest(fake, "opus-mt-en-fr");

  assert.strictEqual(disposeTranslatorNow(), true);
  assert.strictEqual(disposed, 1);
  assert.strictEqual(getTranslatorStatus().currentModelId, null);
  assert.strictEqual(disposeTranslatorNow(), false);
});

test("disposeEngineNow unloads the cached engine", async (t) => {
  t.after(async () => {
    await disposeEngineNow();
  });

  let disposed = 0;

  const fake = {
    dispose: async () => {
      disposed++;
    },
  };

  __setEngineForTest(fake, MODEL_ID);
  assert.equal(getEngineStatus().currentModelId, MODEL_ID);
  assert.equal(await disposeEngineNow(), true);
  assert.equal(disposed, 1);
  assert.equal(getEngineStatus().currentModelId, null);
  assert.equal(await disposeEngineNow(), false);
});

test("withTransformersEngine keeps the cached engine after a transient failure", async (t) => {
  t.after(async () => {
    await disposeEngineNow();
  });

  let disposed = 0;

  const fake = {
    dispose: async () => {
      disposed++;
    },
  };
  __setEngineForTest(fake, MODEL_ID);
  await assert.rejects(
    withTransformersEngine(MODEL_ID, null, async () => {
      throw new Error("network error: failed to fetch");
    }),
    /network error/,
  );

  assert.equal(disposed, 0);
  assert.equal(getEngineStatus().currentModelId, MODEL_ID);
  assert.equal(getEngineStatus().idleDisposeScheduled, true);
});

test("withTransformersEngine disposes the engine after a corrupting failure", async (t) => {
  t.after(async () => {
    await disposeEngineNow();
  });

  let disposed = 0;

  const fake = {
    dispose: async () => {
      disposed++;
    },
  };

  __setEngineForTest(fake, MODEL_ID);

  await assert.rejects(
    withTransformersEngine(MODEL_ID, null, async () => {
      throw new Error("out of memory");
    }),
    /out of memory/,
  );

  assert.equal(disposed, 1);
  assert.equal(getEngineStatus().currentModelId, null);
  assert.equal(getEngineStatus().idleDisposeScheduled, false);
});

test("withTransformersEngine schedules idle disposal after a successful run", async (t) => {
  t.after(async () => {
    await disposeEngineNow();
  });

  let ranWith = null;
  const fake = {
    dispose: async () => { },
  };
  __setEngineForTest(fake, MODEL_ID);

  await withTransformersEngine(MODEL_ID, null, async (eng) => {
    ranWith = eng;
  });
  assert.equal(ranWith, fake);
  assert.equal(getEngineStatus().idleDisposeScheduled, true);
});

test("idle timer disposes the engine after 60 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  try {
    let disposed = 0;

    const fake = {
      dispose: async () => {
        disposed++;
      },
    };

    __setEngineForTest(fake, MODEL_ID);
    await withTransformersEngine(MODEL_ID, null, async () => { });
    assert.equal(getEngineStatus().idleDisposeScheduled, true);

    t.mock.timers.tick(60 * 1000);

    // Allow the async lock acquisition and disposal to complete.
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(disposed, 1);
    assert.equal(getEngineStatus().currentModelId, null);
    assert.equal(getEngineStatus().idleDisposeScheduled, false);
  } finally {
    t.mock.timers.reset();
    await disposeEngineNow();
  }
});

test("new run resets the idle disposal window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  try {
    let disposed = 0;

    const fake = {
      dispose: async () => {
        disposed++;
      },
    };

    __setEngineForTest(fake, MODEL_ID);
    await withTransformersEngine(MODEL_ID, null, async () => { });
    assert.equal(getEngineStatus().idleDisposeScheduled, true);

    // Move halfway through the idle window.
    t.mock.timers.tick(30 * 1000);

    // New run must cancel the old timer and schedule a fresh one.
    await withTransformersEngine(MODEL_ID, null, async (eng) => {
      assert.equal(eng, fake);
    });
    assert.equal(getEngineStatus().idleDisposeScheduled, true);
    // Only 30 seconds have passed since the new run.
    t.mock.timers.tick(30 * 1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disposed, 0);
    assert.equal(getEngineStatus().currentModelId, MODEL_ID);

    // Complete the new 60-second idle window.
    t.mock.timers.tick(30 * 1000);

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(disposed, 1);
    assert.equal(getEngineStatus().currentModelId, null);
  } finally {
    t.mock.timers.reset();
    await disposeEngineNow();
  }
});

test("manual disposal cancels the pending idle timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  try {
    let disposed = 0;

    const fake = {
      dispose: async () => {
        disposed++;
      },
    };

    __setEngineForTest(fake, MODEL_ID);

    await withTransformersEngine(MODEL_ID, null, async () => { });

    assert.equal(getEngineStatus().idleDisposeScheduled, true);
    assert.equal(await disposeEngineNow(), true);
    assert.equal(disposed, 1);
    assert.equal(getEngineStatus().currentModelId, null);
    assert.equal(getEngineStatus().idleDisposeScheduled, false);

    // The cancelled timer must not dispose the engine again.
    t.mock.timers.tick(60 * 1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disposed, 1);
  } finally {
    t.mock.timers.reset();
    await disposeEngineNow();
  }
});

test("after idle disposal, a new run takes the reload path instead of a stale cache", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  try {
    let disposed = 0;
    const fake = {
      dispose: async () => {
        disposed++;
      },
    };

    __setEngineForTest(fake, MODEL_ID);
    await withTransformersEngine(MODEL_ID, null, async () => { });

    // Let the idle timer fire and dispose the engine.
    t.mock.timers.tick(60 * 1000);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(disposed, 1);
    assert.equal(getEngineStatus().currentModelId, null);
    assert.equal(getEngineStatus().idleDisposeScheduled, false);

    // A subsequent run for an unknown model must throw the "Unknown
    // Transformers.js model" load error. If the disposed engine were still
    // cached, ensureEngine would return it and no error would be thrown.
    await assert.rejects(
      withTransformersEngine("unknown-model-id", null, async () => { }),
      /Unknown Transformers\.js model: unknown-model-id/,
    );
  } finally {
    t.mock.timers.reset();
    await disposeEngineNow();
  }
});