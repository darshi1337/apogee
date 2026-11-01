import test from "node:test";
import assert from "node:assert";
import { createCollectingPort } from "../helpers/streamTestUtils.js";

function createChromeMock() {
  const state = { connections: [], cancellations: [], alarms: [] };
  globalThis.chrome = {
    runtime: {
      connect: () => {
        const port = createCollectingPort();
        state.connections.push(port);
        return port;
      },
      sendMessage: async (message) => state.cancellations.push(message),
    },
    alarms: { create: (...args) => state.alarms.push(args) },
  };
  return state;
}

const mock = createChromeMock();
const { connections, cancellations, alarms } = mock;

const {
  relayToOffscreenStream,
  offscreenRelayInflight,
  clearOffscreenRelayRefs,
  hasWorkInFlight,
} = await import("../../background/streams.js");

function relayViewers(streamId, count = 2) {
  return Array.from({ length: count }, () => {
    const popup = createCollectingPort();
    relayToOffscreenStream(popup, streamId);
    return popup;
  });
}

function assertSingleCancellation(streamId) {
  assert.deepStrictEqual(cancellations, [
    {
      target: "offscreen",
      action: "cancel-stream",
      payload: { streamId },
    },
  ]);
}

test.beforeEach(() => {
  connections.length = 0;
  cancellations.length = 0;
  alarms.length = 0;
  offscreenRelayInflight.clear();
});

test("closing one of two viewers preserves the remaining relay", (t) => {
  const [first, second] = relayViewers("webllm-shared");
  const firstOffscreenDisconnect = t.mock.method(connections[0], "disconnect");
  const secondOffscreenDisconnect = t.mock.method(connections[1], "disconnect");
  const secondPopupDisconnect = t.mock.method(second, "disconnect");

  first._emitDisconnect();
  assert.strictEqual(firstOffscreenDisconnect.mock.callCount(), 1);
  assert.strictEqual(secondOffscreenDisconnect.mock.callCount(), 0);
  assert.strictEqual(secondPopupDisconnect.mock.callCount(), 0);
  assert.deepStrictEqual(cancellations, []);
  assert.strictEqual(hasWorkInFlight(), true);
  assert.strictEqual(offscreenRelayInflight.get("webllm-shared"), 1);

  const chunk = { type: "chunk", text: "still generating" };
  connections[1]._emitMessage(chunk);
  assert.deepStrictEqual(second.messages, [chunk]);
  assert.strictEqual(alarms.length, 1);
  assert.strictEqual(alarms[0][0], "stream-cleanup:webllm-shared");

  second._emitDisconnect();
  second._emitDisconnect();
  connections[1]._emitDisconnect();
  assert.strictEqual(secondOffscreenDisconnect.mock.callCount(), 1);
  assertSingleCancellation("webllm-shared");
  assert.strictEqual(hasWorkInFlight(), false);
});

test("closing a single viewer cancels once despite repeated disconnects", () => {
  const [popup] = relayViewers("transformers-single", 1);
  popup._emitDisconnect();
  popup._emitDisconnect();
  connections[0]._emitDisconnect();
  connections[0]._emitDisconnect();
  assertSingleCancellation("transformers-single");
  assert.strictEqual(offscreenRelayInflight.size, 0);
  assert.strictEqual(hasWorkInFlight(), false);
});

for (const type of ["done", "error", "cancelled"]) {
  test(`${type} releases only its relay despite overlapping callbacks`, () => {
    const [finished, remaining] = relayViewers("webllm-terminal");
    const terminal = { type };
    connections[0]._emitMessage(terminal);
    connections[0]._emitMessage(terminal);
    finished._emitDisconnect();
    finished._emitDisconnect();
    connections[0]._emitDisconnect();
    connections[0]._emitDisconnect();

    assert.deepStrictEqual(cancellations, []);
    assert.strictEqual(offscreenRelayInflight.get("webllm-terminal"), 1);
    assert.strictEqual(hasWorkInFlight(), true);

    connections[1]._emitMessage(terminal);
    connections[1]._emitDisconnect();
    remaining._emitDisconnect();
    assert.strictEqual(offscreenRelayInflight.size, 0);
    assert.strictEqual(hasWorkInFlight(), false);
    assert.deepStrictEqual(cancellations, []);
  });
}

test("a terminal message marks the stream complete for every viewer", () => {
  const [, second] = relayViewers("webllm-shared-terminal");

  connections[0]._emitMessage({ type: "done" });
  second._emitDisconnect();
  connections[1]._emitDisconnect();

  assert.deepStrictEqual(cancellations, []);
  assert.strictEqual(offscreenRelayInflight.size, 0);
  assert.strictEqual(hasWorkInFlight(), false);
});

test("last offscreen disconnect cancels once and reports loss", () => {
  const [popup] = relayViewers("webllm-offscreen-last", 1);
  connections[0]._emitDisconnect();
  connections[0]._emitDisconnect();

  assert.deepStrictEqual(popup.messages, [
    { type: "error", error: "Connection to local model was lost" },
  ]);
  assertSingleCancellation("webllm-offscreen-last");
  assert.strictEqual(offscreenRelayInflight.size, 0);
  assert.strictEqual(hasWorkInFlight(), false);

  popup._emitDisconnect();
  assert.strictEqual(cancellations.length, 1);
});

test("unexpected offscreen loss releases once and leaves another viewer active", (t) => {
  const [lost, remaining] = relayViewers("webllm-lost");
  let disconnects = 0;
  t.mock.method(lost, "disconnect", () => {
    disconnects += 1;
    lost._emitDisconnect();
  });

  connections[0]._emitDisconnect();
  connections[0]._emitDisconnect();
  lost._emitDisconnect();
  assert.strictEqual(disconnects, 1);
  assert.deepStrictEqual(lost.messages, [
    { type: "error", error: "Connection to local model was lost" },
  ]);
  assert.deepStrictEqual(cancellations, []);
  assert.strictEqual(offscreenRelayInflight.get("webllm-lost"), 1);
  assert.strictEqual(hasWorkInFlight(), true);

  connections[1]._emitMessage({ type: "chunk", text: "survived" });
  assert.deepStrictEqual(remaining.messages, [
    { type: "chunk", text: "survived" },
  ]);
  remaining._emitDisconnect();
  assert.strictEqual(cancellations.length, 1);
  assert.strictEqual(hasWorkInFlight(), false);
});

test("disconnecting one stream does not release or cancel another stream", () => {
  const [first] = relayViewers("webllm-first", 1);
  relayViewers("transformers-second", 1);
  first._emitDisconnect();
  connections[0]._emitDisconnect();
  assert.deepStrictEqual(
    cancellations.map((message) => message.payload.streamId),
    ["webllm-first"],
  );
  assert.strictEqual(offscreenRelayInflight.has("webllm-first"), false);
  assert.strictEqual(offscreenRelayInflight.get("transformers-second"), 1);
  assert.strictEqual(hasWorkInFlight(), true);
  connections[1]._emitMessage({ type: "done" });
  assert.strictEqual(hasWorkInFlight(), false);
});

test("whole-stream completion tolerates late relay disconnects", () => {
  const [first, second] = relayViewers("webllm-finished");
  relayViewers("webllm-running", 1);

  clearOffscreenRelayRefs("webllm-finished");
  first._emitDisconnect();
  connections[0]._emitDisconnect();
  connections[1]._emitDisconnect();
  second._emitDisconnect();

  assert.deepStrictEqual(cancellations, []);
  assert.strictEqual(offscreenRelayInflight.has("webllm-finished"), false);
  assert.strictEqual(offscreenRelayInflight.get("webllm-running"), 1);
  assert.strictEqual(hasWorkInFlight(), true);
  connections[2]._emitMessage({ type: "done" });
  assert.strictEqual(hasWorkInFlight(), false);
});

test("a synchronous offscreen connection failure acquires no relay reference", (t) => {
  t.mock.method(chrome.runtime, "connect", () => {
    throw new Error("offscreen unavailable");
  });
  assert.throws(
    () => relayToOffscreenStream(createCollectingPort(), "webllm-failed"),
    /offscreen unavailable/,
  );
  assert.strictEqual(offscreenRelayInflight.size, 0);
  assert.strictEqual(hasWorkInFlight(), false);
  assert.deepStrictEqual(cancellations, []);
});
