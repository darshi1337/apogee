import test from "node:test";
import assert from "node:assert";

import { runStreamingJob, createJobStartGate } from "../../ui/jobs.js";
import { StreamCancelledError } from "../../lib/engines/providers.js";
import { PROVIDERS, DEFAULT_SETTINGS } from "../../lib/constants.js";

const settings = (overrides) => ({ ...DEFAULT_SETTINGS, ...overrides });
const LOCAL = PROVIDERS.LOCAL;
const TRANSFORMERS = PROVIDERS.TRANSFORMERS;

function wire(overrides = {}) {
  const calls = [];
  return {
    calls,
    hooks: {
      settings: settings({ provider: LOCAL }),
      chain: [LOCAL, TRANSFORMERS],
      content: "page text",
      reset: () => void calls.push("reset"),
      start: (engine) => engine.summarize(),
      persistStream: async () => "done",
      showCancel: () => void calls.push("showCancel"),
      hideCancel: () => void calls.push("hideCancel"),
      consume: async () => void calls.push("consume"),
      renderFallback: () => void calls.push("renderFallback"),
      ...overrides,
    },
  };
}

function engines(impls) {
  return {
    buildProvider: (type) => {
      if (!impls[type]) throw new Error(`no fake for ${type}`);
      return impls[type];
    },
  };
}

const okEngine = (id) => ({
  summarize: async () => ({ streamId: id, stream: `${id}-stream` }),
});

test("a first-try success wires reset, cancel, consume in order", async () => {
  const { calls, hooks } = wire();
  const result = await runStreamingJob({
    ...hooks,
    ...engines({ [LOCAL]: okEngine("s1"), [TRANSFORMERS]: okEngine("s2") }),
  });
  assert.equal(result, "done");
  assert.deepStrictEqual(calls, [
    "reset",
    "showCancel",
    "consume",
    "hideCancel",
  ]);
});

test("onStreamStart runs after persist and before showCancel", async () => {
  const order = [];
  const { hooks } = wire({
    persistStream: async () => {
      order.push("persist");
      return "done";
    },
    onStreamStart: () => order.push("start"),
    showCancel: () => order.push("show"),
    hideCancel: () => order.push("hide"),
    consume: async () => order.push("consume"),
  });
  const result = await runStreamingJob({
    ...hooks,
    ...engines({ [LOCAL]: okEngine("s1"), [TRANSFORMERS]: okEngine("s2") }),
  });
  assert.equal(result, "done");
  assert.deepStrictEqual(order, [
    "persist",
    "start",
    "show",
    "consume",
    "hide",
  ]);
});

test("an engine failure retries the next engine in chain order", async () => {
  const tried = [];
  const { calls, hooks } = wire({
    start: (engine, type) => {
      tried.push(type);
      return engine.summarize();
    },
  });
  const result = await runStreamingJob({
    ...hooks,
    ...engines({
      [LOCAL]: {
        summarize: async () => {
          throw new Error("down");
        },
      },
      [TRANSFORMERS]: okEngine("s2"),
    }),
  });
  assert.equal(result, "done");
  assert.deepStrictEqual(tried, [LOCAL, TRANSFORMERS]);
  assert.equal(calls.filter((c) => c === "reset").length, 2);
});

test("every engine failing renders the extracted text fallback", async () => {
  const seen = [];
  const { hooks } = wire({
    renderFallback: (text) => void seen.push(text),
  });
  const result = await runStreamingJob({
    ...hooks,
    content: "  page text here  ",
    ...engines({
      [LOCAL]: {
        summarize: async () => {
          throw new Error("a");
        },
      },
      [TRANSFORMERS]: {
        summarize: async () => {
          throw new Error("b");
        },
      },
    }),
  });
  assert.equal(result, "fallback");
  assert.deepStrictEqual(seen, ["page text here"]);
});

test("a superseded attempt cancels its stream and ends silently", async () => {
  const cancelled = [];
  const started = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: (msg) => void cancelled.push(msg),
      lastError: undefined,
    },
  };
  try {
    const { calls, hooks } = wire({
      persistStream: async () => "superseded",
      onStreamStart: (streamId) => started.push(streamId),
    });
    const result = await runStreamingJob({
      ...hooks,
      ...engines({ [LOCAL]: okEngine("s1"), [TRANSFORMERS]: okEngine("s2") }),
    });
    assert.equal(result, "superseded");
    assert.equal(cancelled.length, 1);
    assert.deepStrictEqual(started, []);
    assert.ok(!calls.includes("consume"));
  } finally {
    delete globalThis.chrome;
  }
});

test("cancellation skips the fallback and still hides cancel", async () => {
  const { calls, hooks } = wire({
    consume: async () => {
      throw new StreamCancelledError("Cancelled.");
    },
  });
  await assert.rejects(
    runStreamingJob({
      ...hooks,
      ...engines({ [LOCAL]: okEngine("s1"), [TRANSFORMERS]: okEngine("s2") }),
    }),
    StreamCancelledError,
  );
  assert.deepStrictEqual(calls, ["reset", "showCancel", "hideCancel"]);
});

test("a start gate admits one run and ignores a stale release", () => {
  const gate = createJobStartGate();
  const first = gate.tryStart();
  assert.ok(first);
  assert.equal(gate.tryStart(), null);

  gate.release({});
  assert.equal(gate.tryStart(), null);

  gate.release(first);
  const second = gate.tryStart();
  assert.ok(second);
  assert.notEqual(second, first);
  gate.release(second);
  assert.ok(gate.tryStart());
});

test("onStreamStart and hideCancel receive the stream id", async () => {
  const started = [];
  const hidden = [];
  const { hooks } = wire({
    onStreamStart: (streamId) => started.push(streamId),
    hideCancel: (streamId) => hidden.push(streamId),
  });
  const result = await runStreamingJob({
    ...hooks,
    ...engines({ [LOCAL]: okEngine("s1"), [TRANSFORMERS]: okEngine("s2") }),
  });
  assert.equal(result, "done");
  assert.deepStrictEqual(started, ["s1"]);
  assert.deepStrictEqual(hidden, ["s1"]);
});
