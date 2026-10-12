// Ports close silently when the other end goes away, so every call site
// shares one best-effort wrapper that returns false instead of throwing.
function safePortCall(port, method, ...args) {
  try {
    port[method](...args);
    return true;
  } catch {
    // The other end already went away.
    return false;
  }
}

export function safePost(port, msg) {
  return safePortCall(port, "postMessage", msg);
}

export function safeDisconnect(port) {
  return safePortCall(port, "disconnect");
}

export const KNOWN_PORT_PREFIXES = Object.freeze([
  "offscreen-stream-",
  "popup-stream-",
  "side-panel-tab-",
]);

export const KNOWN_PORT_NAMES = Object.freeze(["popup-lifecycle"]);

export function isKnownPortName(name) {
  return (
    typeof name === "string" &&
    (KNOWN_PORT_NAMES.includes(name) ||
      KNOWN_PORT_PREFIXES.some((prefix) => name.startsWith(prefix)))
  );
}

export function disconnectIfUnknownPort(port, disconnect = safeDisconnect) {
  if (isKnownPortName(port?.name)) return false;
  disconnect(port);
  return true;
}

// Copy the set before iterating: a disconnect mid-loop mutates it
// and the live iteration would skip the next subscriber.
function forEachSubscriber(stream, fn) {
  for (const port of [...stream.subscribers]) {
    fn(port);
  }
}

export function broadcastToStream(stream, msg) {
  forEachSubscriber(stream, (port) => safePost(port, msg));
}

// Drop every subscriber at once (#351), then clear the set in case
// an onDisconnect handler never runs.
export function disconnectStreamPorts(stream) {
  forEachSubscriber(stream, safeDisconnect);
  stream.subscribers.clear();
}
