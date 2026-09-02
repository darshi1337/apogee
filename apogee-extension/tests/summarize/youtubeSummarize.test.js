import test from "node:test";
import assert from "node:assert";

import { summarizeYoutube } from "../../lib/summarize/youtubeSummarize.js";

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

test("summarizeYoutube skips the map stage for a single chunk and assembles straight from the transcript", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "final brief";
  }

  const result = await collect(
    summarizeYoutube(
      {
        text: "[0:00] intro [0:20] middle [0:45] outro",
        title: "My Video",
        url: "https://youtube.com/watch?v=abc",
      },
      {
        chunkTextFn: () => ["[0:00] intro [0:20] middle [0:45] outro"],
        chatStreamFn,
      },
    ),
  );

  assert.deepStrictEqual(result, ["final brief"]);
  assert.strictEqual(
    prompts.length,
    1,
    "only the assembly prompt should run, no map stage",
  );
  assert.match(prompts[0], /My Video/);
  assert.match(prompts[0], /45 seconds/);
});

test("summarizeYoutube runs a map pass per chunk then a single reduce/assembly pass", async () => {
  const calls = [];
  async function* chatStreamFn(_host, _model, prompt) {
    calls.push(prompt);
    yield `notes for: ${prompt.slice(0, 10)}`;
  }

  const progress = [];
  const result = await collect(
    summarizeYoutube(
      {
        text: "irrelevant, chunkTextFn stubbed below",
        title: "Multi-part Video",
        url: "https://youtube.com/watch?v=xyz",
      },
      {
        chunkTextFn: () => ["[0:00] part one", "[5:00] part two"],
        chatStreamFn,
        onProgress: (p) => progress.push(p),
      },
    ),
  );

  assert.strictEqual(calls.length, 3);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(progress, [
    { stage: "map", index: 0, total: 2 },
    { stage: "map", index: 1, total: 2 },
    { stage: "reduce" },
  ]);
  assert.match(calls[2], /Multi-part Video/);
  assert.match(calls[2], /notes for:/);
});

test("summarizeYoutube caps the map-stage chunk size so a long transcript on a big-context model still fans out into map passes", async () => {
  const requestedSizes = [];
  const realChunk = (text, maxChars) => {
    requestedSizes.push(maxChars);
    const n = Math.ceil(text.length / maxChars);
    return Array.from({ length: n }, (_, i) =>
      text.slice(i * maxChars, (i + 1) * maxChars),
    );
  };

  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "notes";
  }

  const progress = [];
  await collect(
    summarizeYoutube(
      {
        text: "[0:00] " + "poker cheating scandal details ".repeat(700),
        title: "Poker Video",
        url: "https://youtube.com/watch?v=abc",
      },
      {
        chunkTextFn: realChunk,
        chatStreamFn,
        onProgress: (p) => progress.push(p),
      },
    ),
  );

  assert.strictEqual(requestedSizes[0], 8192);
  assert.ok(prompts.length > 1, "should run multiple map passes plus a reduce");
  assert.ok(
    progress.some((p) => p.stage === "map"),
    "should emit map-stage progress",
  );
  assert.match(prompts[prompts.length - 1], /TIMESTAMPED NOTES:/);
});

test("summarizeYoutube uses the fixed brief + key-moments video format regardless of mode", async () => {
  async function run(mode) {
    const prompts = [];
    async function* chatStreamFn(_host, _model, prompt) {
      prompts.push(prompt);
      yield "brief";
    }
    await collect(
      summarizeYoutube(
        {
          text: "[0:00] hello world",
          title: "My Video",
          url: "https://youtube.com/watch?v=abc",
          mode,
        },
        { chunkTextFn: () => ["[0:00] hello world"], chatStreamFn },
      ),
    );
    return prompts[0];
  }

  const paragraphsPrompt = await run("paragraphs");
  const bulletsPrompt = await run("bullets");

  assert.match(paragraphsPrompt, /## Key moments/);
  assert.match(paragraphsPrompt, /key moments, matching this video's length/);
  assert.doesNotMatch(
    paragraphsPrompt,
    /Output one concise paragraph containing 10-15 sentences/,
  );
  assert.strictEqual(paragraphsPrompt, bulletsPrompt);
});

test("summarizeYoutube assembles a chaptered brief when the content carries a Chapters block", async () => {
  const prompts = [];
  async function* chatStreamFn(_host, _model, prompt) {
    prompts.push(prompt);
    yield "brief";
  }

  const text = [
    "Video Title:",
    "My Talk",
    "",
    "Chapters:",
    "- [0:00] Intro",
    "- [0:30] Middle",
    "- [1:00] Wrap up",
    "",
    "Transcript:",
    "[0:00] hi [0:30] mid [1:00] bye",
  ].join("\n");

  await collect(
    summarizeYoutube(
      {
        text,
        title: "My Talk",
        url: "https://youtube.com/watch?v=abc",
        mode: "paragraphs",
      },
      { chunkTextFn: (t) => [t], chatStreamFn },
    ),
  );

  assert.match(prompts[0], /## Overview/);
  assert.match(prompts[0], /\*\*Key Takeaways\*\*/);
  assert.match(prompts[0], /Intro/);
  assert.match(prompts[0], /Wrap up/);
  assert.doesNotMatch(
    prompts[0],
    /Output one concise paragraph containing 10-15 sentences/,
  );
  assert.match(prompts[0], /watch\?v=abc&t=60s/);
  assert.doesNotMatch(prompts[0], /- \[0:30\] Middle/);
});

test("summarizeYoutube stops issuing new model calls once the signal is aborted between chunks", async () => {
  const controller = new AbortController();
  let calls = 0;
  // eslint-disable-next-line require-yield
  async function* chatStreamFn() {
    calls += 1;
    controller.abort();
  }

  const result = await collect(
    summarizeYoutube(
      {
        text: "irrelevant",
        title: "t",
        url: "https://youtube.com/watch?v=abc",
        signal: controller.signal,
      },
      {
        chunkTextFn: () => ["chunk one", "chunk two", "chunk three"],
        chatStreamFn,
      },
    ),
  );

  assert.deepStrictEqual(result, []);
  assert.strictEqual(
    calls,
    1,
    "should not call the model for chunk two/three or the reduce merge after abort",
  );
});

test("summarizeYoutube keeps every chunk when the input exceeds the chunk cap and tree-reduces them", async () => {
  // 300k chars at the model-derived chunk size yields ~37 chunks once
  // the YouTube-specific YOUTUBE_MAP_CHUNK_CHARS cap (8192) is applied.
  // Before the hierarchical map-reduce change, this dropped to 12 (and
  // lost ~70% of the material). Now we keep every chunk, map them all,
  // and tree-reduce the partials down to <= 12, then final reduce
  // once. The exact call count depends on getMaxChunkChars for the
  // (unspecified) model; we assert the shape of the events and the
  // presence of intermediate tree-reduce calls instead of a hard
  // number.
  const longText = "x".repeat(300000);
  const chunkCalls = [];
  const chunkTextFn = (text, maxChars) => {
    chunkCalls.push(maxChars);
    const n = Math.ceil(text.length / maxChars);
    return Array.from({ length: n }, () => "x");
  };

  let mapCalls = 0;
  async function* chatStreamFn() {
    mapCalls++;
    yield "x";
  }

  const progressEvents = [];
  await collect(
    summarizeYoutube(
      { text: longText, title: "t", url: "https://youtube.com/watch?v=abc" },
      { chunkTextFn, chatStreamFn, onProgress: (p) => progressEvents.push(p) },
    ),
  );

  assert.strictEqual(chunkCalls.length, 1, "should never re-chunk bigger");
  // No truncation by default - the new pipeline keeps every chunk.
  const truncated = progressEvents.filter((p) => p.stage === "truncated");
  assert.strictEqual(
    truncated.length,
    0,
    "no chunks are dropped by default; the tree-reduce folds them instead",
  );
  // The map stage should produce more than the budget (12) so the
  // tree stage actually fires. The YOUTUBE_MAP_CHUNK_CHARS cap yields
  // ~37 chunks from 300k chars.
  const mapEvents = progressEvents.filter((p) => p.stage === "map");
  assert.ok(
    mapEvents.length > 12,
    `map stage should produce more than 12 chunks, got ${mapEvents.length}`,
  );
  // At least one intermediate tree-reduce call plus a final reduce.
  const intermediateReduces = progressEvents.filter(
    (p) => p.stage === "reduce" && p.depth === 1,
  );
  const finalReduces = progressEvents.filter(
    (p) => p.stage === "reduce" && p.depth === undefined,
  );
  assert.ok(
    intermediateReduces.length > 0,
    "expected at least one intermediate reduce (the tree must fire)",
  );
  assert.strictEqual(finalReduces.length, 1);
  // The final reduce must see <= 12 partials (the budget).
  const finalReduce = progressEvents[progressEvents.length - 1];
  assert.strictEqual(finalReduce.stage, "reduce");
  // The chat fn was called once per map + once per intermediate
  // reduce + once for the final reduce. We already know the map
  // count; just assert it's strictly more than the 13 (12 maps + 1
  // final) the old pipeline produced.
  assert.ok(
    mapCalls > 13,
    `old pipeline did 13 model calls; new pipeline does at least 13+ (got ${mapCalls})`,
  );
});
