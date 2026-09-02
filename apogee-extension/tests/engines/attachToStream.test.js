import test from "node:test";
import assert from "node:assert";

import {
  attachToStream,
  StreamCancelledError,
} from "../../lib/engines/providers.js";
import { toUserMessage } from "../../lib/util/userError.js";

function createFakePort() {
  const listeners = { message: [], disconnect: [] };
  return {
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onDisconnect: { addListener: (fn) => listeners.disconnect.push(fn) },
    disconnect: () => {},
    _emitMessage: (msg) => listeners.message.forEach((fn) => fn(msg)),
    _emitDisconnect: () => listeners.disconnect.forEach((fn) => fn()),
  };
}

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

test("attachToStream yields buffered chunks and completes on a normal done+disconnect", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const resultsPromise = collect(attachToStream("stream-1"));
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "chunk", text: "hello " });
  port._emitMessage({ type: "chunk", text: "world" });
  port._emitMessage({ type: "done" });
  port._emitDisconnect();

  assert.deepStrictEqual(await resultsPromise, ["hello ", "world"]);
});

test("attachToStream reports a live stats message through onStats", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const received = [];
  const resultsPromise = collect(
    attachToStream("stream-stats", { onStats: (rate) => received.push(rate) }),
  );
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "chunk", text: "hello" });
  port._emitMessage({ type: "stats", tokensPerSec: 12.5 });
  port._emitMessage({ type: "done" });
  port._emitDisconnect();

  await resultsPromise;
  assert.deepStrictEqual(received, [12.5]);
});

test("attachToStream reports the frozen rate on a done message with tokensPerSec", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const received = [];
  const resultsPromise = collect(
    attachToStream("stream-frozen", { onStats: (rate) => received.push(rate) }),
  );
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "chunk", text: "hello" });
  port._emitMessage({ type: "done", tokensPerSec: 30 });
  port._emitDisconnect();

  await resultsPromise;
  assert.deepStrictEqual(received, [30]);
});

test("attachToStream does not call onStats for a done message with no tokensPerSec", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  let called = false;
  const resultsPromise = collect(
    attachToStream("stream-no-stats", { onStats: () => (called = true) }),
  );
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "chunk", text: "hello" });
  port._emitMessage({ type: "done" });
  port._emitDisconnect();

  await resultsPromise;
  assert.strictEqual(called, false);
});

test("attachToStream surfaces the sender's error message instead of swallowing it", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const run = collect(attachToStream("stream-2"));
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "error", error: "Ollama returned an error" });

  await assert.rejects(run, /Ollama returned an error/);
});

test("attachToStream yields buffered chunks before throwing StreamCancelledError on cancel", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const gen = attachToStream("stream-4");
  const received = [];
  const run = (async () => {
    for await (const chunk of gen) received.push(chunk);
  })();
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "chunk", text: "partial " });
  port._emitMessage({ type: "chunk", text: "text" });
  port._emitMessage({ type: "cancelled" });

  await assert.rejects(run, StreamCancelledError);
  assert.deepStrictEqual(received, ["partial ", "text"]);
});

test("attachToStream errors (instead of silently truncating) when the port disconnects before done/error", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const run = collect(attachToStream("stream-3"));
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "chunk", text: "partial" });
  port._emitDisconnect();

  await assert.rejects(run, /Connection to the model was lost/);
});

// A message written for the user only survives the port if the marker travels with it. Without this, attachToStream rebuilt a plain Error, toUserMessage fell through to its pattern table, and "Could not connect to llama.cpp..." was rewritten as "Could not connect to Ollama..." because the table matches on "could not connect".
test("attachToStream keeps an error that was written for the user intact", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const run = collect(attachToStream("stream-user-facing"));
  await new Promise((r) => setTimeout(r, 0));

  const written =
    "Could not connect to llama.cpp at http://127.0.0.1:8080. " +
    "Is llama-server running and listening on that address?";
  port._emitMessage({ type: "error", error: written, userFacing: true });

  await assert.rejects(run, (err) => {
    assert.equal(err.isUserFacing, true, "marker must survive the port");
    assert.equal(
      toUserMessage(err),
      written,
      "a user-facing message must not be run through the fallback table",
    );
    return true;
  });
});

test("attachToStream still lets an unmarked error be mapped to a fallback", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const run = collect(attachToStream("stream-raw"));
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "error", error: "TypeError: fetch failed" });

  await assert.rejects(run, (err) => {
    assert.notEqual(err.isUserFacing, true);
    return true;
  });
});
