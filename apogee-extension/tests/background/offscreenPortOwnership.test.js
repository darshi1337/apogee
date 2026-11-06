import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readSource } from "../helpers/readSource.js";

const source = readSource("../../offscreen/offscreen.js", import.meta.url);
const start = source.indexOf("chrome.runtime.onConnect.addListener(");
const end = source.indexOf("chrome.runtime.onMessage.addListener(", start);
let connect;
const streams = new Map();
vm.runInNewContext(source.slice(start, end), {
  chrome: {
    runtime: {
      id: "apogee",
      onConnect: {
        addListener(fn) {
          connect = fn;
        },
      },
    },
  },
  streams,
  safeDisconnect: (port) => {
    port.disconnected = true;
  },
  safePost: (port, message) => port.messages.push(message),
  replayStreamToPort: (_stream, port) =>
    port.messages.push({ type: "replayed" }),
});
const port = (name, tab = null) => ({
  name,
  sender: { id: "apogee", ...(tab ? { tab } : {}) },
  messages: [],
  disconnected: false,
  onDisconnect: { addListener() {} },
});

test("an offscreen document leaves worker-owned extension-tab ports connected", () => {
  for (const name of [
    "popup-stream-remote-443",
    "popup-lifecycle",
    "side-panel-tab-443",
  ]) {
    const viewPort = port(name, { id: 443 });
    connect(viewPort);
    assert.equal(viewPort.disconnected, false);
    assert.deepEqual(viewPort.messages, []);
  }
});

test("offscreen streams retain the service-worker sender boundary", () => {
  const untrusted = port("offscreen-stream-known", { id: 443 });
  connect(untrusted);
  assert.equal(untrusted.disconnected, true);
  const trusted = port("offscreen-stream-known");
  const state = { subscribers: new Set() };
  streams.set("known", state);
  connect(trusted);
  assert.equal(trusted.disconnected, false);
  assert.equal(state.subscribers.has(trusted), true);
  assert.equal(trusted.messages[0].type, "replayed");
});
