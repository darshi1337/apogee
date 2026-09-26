// Fake extension port shared by the stream tests: collects posted messages
// for producer-side assertions (broadcast/replay) and emits inbound
// messages for consumer-side tests (attachToStream), replacing the
// per-file createFakePort duplicates.
export function createCollectingPort({ throwOnPost = false } = {}) {
  const messages = [];
  const listeners = { message: [], disconnect: [] };
  return {
    messages,
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onDisconnect: { addListener: (fn) => listeners.disconnect.push(fn) },
    postMessage(msg) {
      if (throwOnPost) {
        throw new Error("Port disconnected");
      }
      messages.push(msg);
    },
    disconnect() {},
    _emitMessage: (msg) => listeners.message.forEach((fn) => fn(msg)),
    _emitDisconnect: () => listeners.disconnect.forEach((fn) => fn()),
  };
}

export function withMockPerformanceClock(fn) {
  const origNow = performance.now;
  let currentTime = 1000;
  performance.now = () => currentTime;
  const advanceClock = (ms) => {
    currentTime += ms;
  };
  const restoreClock = () => {
    performance.now = origNow;
  };

  let result;
  try {
    result = fn({ advanceClock });
  } catch (err) {
    restoreClock();
    throw err;
  }
  // Keep the mock clock installed until async test bodies settle; otherwise
  // the real clock leaks into post-await assertions.
  if (result && typeof result.then === "function") {
    return result.finally(restoreClock);
  }
  restoreClock();
  return result;
}
