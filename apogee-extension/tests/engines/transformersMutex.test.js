import test from "node:test";
import assert from "node:assert";
import {
  isTransientLoadError,
  isEngineCorruptingError,
  withTranslator,
  disposeTranslatorNow,
  getTranslatorStatus,
  __setTranslatorForTest,
} from "../../lib/engines/transformersEngine.js";

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
