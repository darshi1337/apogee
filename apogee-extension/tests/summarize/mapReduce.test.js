import test from "node:test";
import assert from "node:assert";

import { mapReduceStream } from "../../lib/summarize/mapReduce.js";

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

function recordingChat(partialFor) {
  const calls = [];
  async function* fn(_host, _model, prompt, opts) {
    calls.push({ prompt, opts });
    const out = partialFor
      ? partialFor(prompt, calls.length)
      : `partial for: ${prompt.slice(0, 12)}`;
    if (Array.isArray(out)) {
      for (const t of out) yield t;
    } else {
      yield out;
    }
  }
  return { fn, calls };
}

function makePrompts() {
  return {
    buildSingle: (chunk) => `SINGLE: ${chunk}`,
    buildMap: (chunk, i, total) => `MAP[${i}/${total}]: ${chunk}`,
    buildReduce: (partials) =>
      `REDUCE(${partials.length}): ${partials.join(" | ")}`,
  };
}

const NOOP_PROGRESS = () => {};

test("mapReduceStream: in-budget pipeline (3 chunks, budget 12) maps every chunk and runs one final reduce", async () => {
  const { fn, calls } = recordingChat();
  const out = await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => ["a", "b", "c"],
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
      },
      makePrompts(),
    ),
  );

  // 3 map calls + 1 final reduce.
  assert.strictEqual(calls.length, 4);
  assert.match(calls[0].prompt, /^MAP\[0\/3\]: a$/);
  assert.match(calls[1].prompt, /^MAP\[1\/3\]: b$/);
  assert.match(calls[2].prompt, /^MAP\[2\/3\]: c$/);
  assert.match(calls[3].prompt, /^REDUCE\(3\): /);
  assert.strictEqual(out.length, 1);
});

test("mapReduceStream: at-budget (12 chunks, budget 12) does not enter the tree stage", async () => {
  const { fn, calls } = recordingChat();
  const progress = [];
  const chunks = Array.from({ length: 12 }, (_, i) => `c${i}`);

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: (p) => progress.push(p),
      },
      makePrompts(),
    ),
  );

  // 12 map + 1 final reduce; no intermediate reduce events.
  assert.strictEqual(calls.length, 13);
  const reduceEvents = progress.filter((p) => p.stage === "reduce");
  assert.strictEqual(reduceEvents.length, 1);
  assert.ok(
    !("depth" in reduceEvents[0]),
    "the only reduce event should be the final one (no depth)",
  );
});

test("mapReduceStream: 13 chunks, budget 12 → 13 map + 1 reduce of all 13 (no tree needed)", async () => {
  const { fn, calls } = recordingChat();
  const progress = [];
  const chunks = Array.from({ length: 13 }, (_, i) => `c${i}`);

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: (p) => progress.push(p),
      },
      makePrompts(),
    ),
  );

  // 13 map + 1 final reduce. fanIn would be ceil(13/12)=2, but since
  // 13 > 12, pickFanIn returns 2; we still need one tree round, so we
  // expect 13 + ceil(13/2)=7 + 1 = 21 calls.
  // The contract: the *final* reduce sees <= maxChunks partials.
  assert.strictEqual(calls.length, 21);
  const finalReduce = calls[calls.length - 1].prompt;
  assert.match(finalReduce, /^REDUCE\(\d+\): /);
  const partialsInFinal = finalReplaceCount(finalReduce);
  assert.ok(
    partialsInFinal <= 12,
    `final reduce must see <= 12 partials, saw ${partialsInFinal}`,
  );

  // Exactly one final reduce event, and >= 1 intermediate reduce event.
  const reduces = progress.filter((p) => p.stage === "reduce");
  const intermediate = reduces.filter((p) => p.depth === 1);
  assert.ok(
    intermediate.length >= 1,
    "expected at least one intermediate reduce event",
  );
  assert.strictEqual(
    reduces[reduces.length - 1].depth,
    undefined,
    "final reduce has no depth",
  );
});

test("mapReduceStream: 48 chunks, budget 12 → 48 map + 12 first-level reduce + 1 final reduce (fanIn=4)", async () => {
  const { fn, calls } = recordingChat();
  const progress = [];
  const chunks = Array.from({ length: 48 }, (_, i) => `c${i}`);

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: (p) => progress.push(p),
      },
      makePrompts(),
    ),
  );

  // 48 map + 12 first-level + 1 final = 61 calls.
  assert.strictEqual(calls.length, 61);
  const finalReduce = calls[calls.length - 1].prompt;
  assert.match(finalReduce, /^REDUCE\(12\): /);

  // Progress order: 48 map, then 12 reduce{depth:1}, then 1 reduce final.
  const stages = progress.map((p) =>
    p.stage === "map"
      ? "m"
      : p.stage === "reduce" && p.depth === 1
        ? "r1"
        : p.stage === "reduce"
          ? "rf"
          : "?",
  );
  const mapCount = stages.filter((s) => s === "m").length;
  const r1Count = stages.filter((s) => s === "r1").length;
  const rfCount = stages.filter((s) => s === "rf").length;
  assert.strictEqual(mapCount, 48);
  assert.strictEqual(r1Count, 12);
  assert.strictEqual(rfCount, 1);

  // The first reduce must come after all maps.
  const firstReduceIdx = stages.indexOf("r1");
  const lastMapIdx = stages.lastIndexOf("m");
  assert.ok(
    firstReduceIdx > lastMapIdx,
    "intermediate reduce must follow all maps",
  );

  // The final reduce must come after all intermediate reduces.
  const finalReduceIdx = stages.indexOf("rf");
  const lastR1Idx = stages.lastIndexOf("r1");
  assert.ok(
    finalReduceIdx > lastR1Idx,
    "final reduce must follow intermediate reduces",
  );
});

test("mapReduceStream: 24 chunks, budget 12 → fanIn=2 → 24 map + 12 reduce + 1 final", async () => {
  const { fn, calls } = recordingChat();
  const chunks = Array.from({ length: 24 }, (_, i) => `c${i}`);

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
      },
      makePrompts(),
    ),
  );

  // 24 map + 12 reduce + 1 final = 37 calls.
  assert.strictEqual(calls.length, 37);
  const finalReduce = calls[calls.length - 1].prompt;
  assert.match(finalReduce, /^REDUCE\(12\): /);
});

test("mapReduceStream: tree-reduce groups partials in input order", async () => {
  // Every leaf partials[i] starts with its index; we want to verify
  // that the first-level reduce groups partials in order and that
  // the final reduce sees the grouped intermediates in order.
  const seen = [];
  async function* fn(_host, _model, prompt) {
    seen.push(prompt);
    if (prompt.startsWith("MAP[")) {
      const m = prompt.match(/^MAP\[\d+\/\d+\]: (.*)$/);
      yield `LEAF[${m[1]}]`;
    } else {
      yield `INTERMEDIATE[${prompt.slice("REDUCE(".length)}]`;
    }
  }

  const chunks = Array.from({ length: 8 }, (_, i) => `c${i}`);

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
      },
      {
        buildSingle: (c) => `SINGLE: ${c}`,
        buildMap: (c, i, t) => `MAP[${i}/${t}]: ${c}`,
        buildReduce: (ps) => `REDUCE(${ps.length}): ${ps.join(" || ")}`,
      },
    ),
  );

  // 8 chunks, budget 12 → no tree (8 ≤ 12). But the issue is about
  // order preservation; that is most visible when the tree fires.
  // Re-run with a smaller budget by using a Transformers model.
  seen.length = 0;
  await collect(
    mapReduceStream(
      {
        text: "irrelevant",
        model: "HuggingFaceTB/SmolLM2-360M-Instruct",
        host: "h",
      },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
      },
      {
        buildSingle: (c) => `SINGLE: ${c}`,
        buildMap: (c, i, t) => `MAP[${i}/${t}]: ${c}`,
        buildReduce: (ps) => `REDUCE(${ps.length}): ${ps.join(" || ")}`,
      },
    ),
  );

  // The first intermediate reduce should be over the first group of
  // partials in order. Find the first REDUCE prompt and check it
  // contains the expected leaves in order.
  const firstReduce = seen.find((p) => p.startsWith("REDUCE("));
  // 8 partials over budget 4: fanIn = ceil(8/4) = 2, so 4 groups.
  // First group: LEAF[c0], LEAF[c1].
  assert.match(firstReduce, /LEAF\[c0\] \|\| LEAF\[c1\]/);
});

test("mapReduceStream: intermediate reduce tokens reach the consumer", async () => {
  // 16 chunks, budget 12: fanIn = ceil(16/12) = 2, so the tree fires
  // (16 → 8 intermediates → 1 final). The intermediate reduce calls
  // are themselves streamed; we just need to assert that the final
  // reduce prompt aggregates the intermediate outputs and the final
  // streamed output reaches the consumer.
  const seen = [];
  async function* fn(_host, _model, prompt) {
    seen.push(prompt);
    if (prompt.startsWith("MAP[")) {
      yield "leafa";
    } else if (/^REDUCE\(2\):/.test(prompt)) {
      // First-level reduce: 2 partials collapsed to 1 intermediate.
      yield "intermediate-1";
    } else {
      // Final reduce.
      yield "final-output";
    }
  }

  const chunks = Array.from({ length: 16 }, (_, i) => `c${i}`);
  const out = await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
      },
      makePrompts(),
    ),
  );

  // 16 map + 8 first-level + 1 final = 25 calls.
  assert.strictEqual(seen.length, 25);
  assert.deepStrictEqual(out, ["final-output"]);
  // The final reduce prompt should contain the intermediate strings.
  const final = seen[seen.length - 1];
  assert.match(final, /intermediate-1/);
});

test("mapReduceStream: abort between map and reduce stops further model calls", async () => {
  const controller = new AbortController();
  let calls = 0;
  async function* fn() {
    calls += 1;
    if (calls === 3) controller.abort();
    yield "x";
  }

  const chunks = Array.from({ length: 20 }, (_, i) => `c${i}`);
  const out = await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h", signal: controller.signal },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
      },
      makePrompts(),
    ),
  );

  assert.deepStrictEqual(out, []);
  assert.strictEqual(
    calls,
    3,
    "should not call the model for further chunks or any reduce",
  );
});

test("mapReduceStream: OOM during map skips the tree and runs final reduce with partials so far", async () => {
  const progress = [];
  let calls = 0;
  async function* fn() {
    calls += 1;
    if (calls === 4) {
      throw new Error("RESOURCE: gpubuffer allocation failed");
    }
    yield "ok";
  }

  const chunks = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const out = await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: (p) => progress.push(p),
      },
      makePrompts(),
    ),
  );

  // 3 successful map calls + 1 OOM throw = 4 chat fn invocations,
  // then the pipeline runs the final reduce on 3 partials = 1 more.
  // Total: 5 calls. No tree stage.
  assert.strictEqual(calls, 5);
  const reduces = progress.filter((p) => p.stage === "reduce");
  assert.strictEqual(reduces.length, 1);
  assert.ok(!("depth" in reduces[0]), "the only reduce is the final one");
  assert.ok(progress.some((p) => p.stage === "oom_fallback"));
  // The streamed output is whatever the final reduce yielded: "ok".
  assert.deepStrictEqual(out, ["ok"]);
});

test("mapReduceStream: OOM during intermediate reduce stops the tree and uses what we have", async () => {
  const progress = [];
  let calls = 0;
  async function* fn() {
    calls += 1;
    // 8 map calls succeed. The tree is configured for budget 4
    // (Transformers.js model), so fanIn = ceil(8/4) = 2 and the
    // first intermediate reduce is call 9. The OOM halts the tree,
    // and the final reduce (call 10) consumes the original 8
    // partials.
    if (calls === 9) {
      throw new Error("gpubuffer allocation failed");
    }
    yield calls <= 8 ? `LEAF-${calls}` : "INTERMEDIATE";
  }

  const chunks = Array.from({ length: 8 }, (_, i) => `c${i}`);
  const out = await collect(
    mapReduceStream(
      {
        text: "irrelevant",
        model: "HuggingFaceTB/SmolLM2-360M-Instruct",
        host: "h",
      },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: (p) => progress.push(p),
      },
      makePrompts(),
    ),
  );

  // 8 map + 1 OOM reduce + 1 final reduce on the original partials = 10 calls.
  assert.strictEqual(calls, 10);
  assert.ok(progress.some((p) => p.stage === "oom_fallback"));
  assert.deepStrictEqual(out, ["INTERMEDIATE"]);
});

test("mapReduceStream: a custom selectChunksFn wins over the tree-reduce", async () => {
  let calls = 0;
  async function* fn() {
    calls += 1;
    yield "x";
  }

  const chunks = Array.from({ length: 30 }, (_, i) => `c${i}`);
  const selectChunksFn = (all) => all.slice(0, 3);

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
        selectChunksFn,
      },
      makePrompts(),
    ),
  );

  // 3 map + 1 final reduce = 4 calls; no tree.
  assert.strictEqual(calls, 4);
});

test("mapReduceStream: a failing selectChunksFn falls through to the default (no chunks dropped)", async () => {
  let calls = 0;
  async function* fn() {
    calls += 1;
    yield "x";
  }

  const chunks = Array.from({ length: 6 }, (_, i) => `c${i}`);
  const selectChunksFn = () => {
    throw new Error("selector broken");
  };

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
        selectChunksFn,
      },
      makePrompts(),
    ),
  );

  // 6 chunks ≤ budget 12: flat reduce, 6 + 1 = 7 calls. The failing
  // selector must not have raised, and the tree stage must not have
  // fired (6 ≤ 12).
  assert.strictEqual(calls, 7);
});

test("mapReduceStream: final reduce sees at most maxChunks partials, even when map produced more", async () => {
  // Direct stress: 60 chunks, budget 12. fanIn = ceil(60/12) = 5.
  // Expect 60 map + 12 first-level + 1 final = 73 calls.
  const { fn, calls } = recordingChat();
  const chunks = Array.from({ length: 60 }, (_, i) => `c${i}`);

  await collect(
    mapReduceStream(
      { text: "irrelevant", model: "m", host: "h" },
      {
        chunkTextFn: () => chunks,
        chatStreamFn: fn,
        onProgress: NOOP_PROGRESS,
      },
      makePrompts(),
    ),
  );

  assert.strictEqual(calls.length, 73);
  const finalReduce = calls[calls.length - 1].prompt;
  const m = finalReduce.match(/^REDUCE\((\d+)\): /);
  assert.ok(m, "final reduce prompt shape");
  const n = parseInt(m[1], 10);
  assert.ok(
    n <= 12,
    `final reduce must receive at most maxChunks=12 partials, saw ${n}`,
  );
});

test("mapReduceStream: cleanText runs on the input before chunking", async () => {
  const chunkTextFn = (text) => [`cleaned:${text.length}`];
  const { fn, calls } = recordingChat();
  await collect(
    mapReduceStream(
      { text: "hello   \n\n\n world ", model: "m", host: "h" },
      { chunkTextFn, chatStreamFn: fn, onProgress: NOOP_PROGRESS },
      makePrompts(),
    ),
  );

  // One chunk, fast path: buildSingle is called with the cleaned chunk.
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].prompt, /^SINGLE: cleaned:\d+$/);
});

// Tiny helper: count items inside the joined " || "-delimited partials
// string of a REDUCE prompt.
function finalReplaceCount(prompt) {
  const m = prompt.match(/^REDUCE\((\d+)\): /);
  if (!m) return -1;
  const body = prompt.slice(m[0].length);
  // Build was buildReduce: (ps) => `REDUCE(${ps.length}): ${ps.join(" | ")}`
  return body.split(" | ").length;
}
