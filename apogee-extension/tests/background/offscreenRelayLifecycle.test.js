import test from "node:test";
import assert from "node:assert";
import { createCollectingPort } from "../helpers/streamTestUtils.js";

const connections = [];
const cancellations = [];
const alarms = [];
globalThis.chrome = {
  runtime: {
    connect: () => {
      const port = createCollectingPort();
      connections.push(port);
      return port;
    },
    sendMessage: async (message) => cancellations.push(message),
  },
  alarms: { create: (...args) => alarms.push(args) },
};

const {
  relayToOffscreenStream,
  offscreenRelayInflight,
  clearOffscreenRelays,
  hasWorkInFlight,
} = await import("../../background/streams.js");

test.beforeEach(() => {
  connections.length = 0;
  cancellations.length = 0;
  alarms.length = 0;
  offscreenRelayInflight.clear();
});

test("closing one of two viewers preserves the remaining relay", (t) => {
  const first = createCollectingPort();
  const second = createCollectingPort();
  relayToOffscreenStream(first, "webllm-shared");
  relayToOffscreenStream(second, "webllm-shared");
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
  assert.strictEqual(cancellations.length, 1);
  assert.deepStrictEqual(cancellations[0], {
    target: "offscreen",
    action: "cancel-stream",
    payload: { streamId: "webllm-shared" },
  });
  assert.strictEqual(hasWorkInFlight(), false);
});

test("closing a single viewer cancels once despite repeated disconnects", () => {
  const popup = createCollectingPort();
  relayToOffscreenStream(popup, "transformers-single");
  popup._emitDisconnect();
  popup._emitDisconnect();
  connections[0]._emitDisconnect();
  connections[0]._emitDisconnect();
  assert.strictEqual(cancellations.length, 1);
  assert.strictEqual(offscreenRelayInflight.size, 0);
  assert.strictEqual(hasWorkInFlight(), false);
});

for (const type of ["done", "error", "cancelled"]) {
  test(`${type} releases only its relay despite overlapping callbacks`, () => {
    const finished = createCollectingPort();
    const remaining = createCollectingPort();
    relayToOffscreenStream(finished, "webllm-terminal");
    relayToOffscreenStream(remaining, "webllm-terminal");
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

test("unexpected offscreen loss releases once and leaves another viewer active", () => {
  const lost = createCollectingPort();
  let disconnects = 0;
  lost.disconnect = () => {
    disconnects += 1;
    lost._emitDisconnect();
  };
  const remaining = createCollectingPort();
  relayToOffscreenStream(lost, "webllm-lost");
  relayToOffscreenStream(remaining, "webllm-lost");

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
  const first = createCollectingPort();
  const second = createCollectingPort();
  relayToOffscreenStream(first, "webllm-first");
  relayToOffscreenStream(second, "transformers-second");
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
  const first = createCollectingPort();
  const second = createCollectingPort();
  const independent = createCollectingPort();
  relayToOffscreenStream(first, "webllm-finished");
  relayToOffscreenStream(second, "webllm-finished");
  relayToOffscreenStream(independent, "webllm-running");

  clearOffscreenRelays("webllm-finished");
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

test("a synchronous offscreen connection failure acquires no relay reference", () => {
  const connect = chrome.runtime.connect;
  chrome.runtime.connect = () => {
    throw new Error("offscreen unavailable");
  };
  try {
    assert.throws(
      () => relayToOffscreenStream(createCollectingPort(), "webllm-failed"),
      /offscreen unavailable/,
    );
    assert.strictEqual(offscreenRelayInflight.size, 0);
    assert.strictEqual(hasWorkInFlight(), false);
    assert.deepStrictEqual(cancellations, []);
  } finally {
    chrome.runtime.connect = connect;
  }
});
