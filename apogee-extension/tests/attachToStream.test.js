import test from "node:test";
import assert from "node:assert";

import { attachToStream } from "../lib/providers.js";

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

test("attachToStream surfaces the sender's error message instead of swallowing it", async () => {
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const run = collect(attachToStream("stream-2"));
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "error", error: "Ollama returned an error" });

  await assert.rejects(run, /Ollama returned an error/);
});

test("attachToStream errors (instead of silently truncating) when the port disconnects before done/error", async () => {
  // Simulates the service worker being evicted mid-stream (MV3 kills it
  // after ~30s of inactivity), the port drops with no terminal message.
  const port = createFakePort();
  globalThis.chrome = { runtime: { connect: () => port } };

  const run = collect(attachToStream("stream-3"));
  await new Promise((r) => setTimeout(r, 0));

  port._emitMessage({ type: "chunk", text: "partial" });
  port._emitDisconnect();

  await assert.rejects(run, /Connection to the model was lost/);
});
