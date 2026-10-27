import {
  runWithEngineFallback,
  cancelStream,
} from "../lib/engines/providers.js";

// Blocks a second start until the first run has a stream, so double clicks
// cannot spawn parallel jobs. A stale release from a superseded run is a no-op.
export function createJobStartGate() {
  let owner = null;
  return {
    tryStart() {
      if (owner) return null;
      owner = {};
      return owner;
    },
    release(token) {
      if (owner === token) owner = null;
    },
  };
}

// One runner for every streaming popup job: page summarize, custom-content
// summarize, and ask. Each attempt resets the UI, starts the engine,
// persists per-attempt state, shows cancel, and consumes the stream. Engine
// failures fall back to the next engine in chain order. A "superseded"
// persist ends the job silently when a newer job took over. "fallback"
// means every engine failed and renderFallback showed extracted text.
// Everything DOM- or chrome-specific arrives as a callback, so this module
// has no browser dependencies and plain Node tests drive it with fakes.
export async function runStreamingJob({
  settings,
  chain,
  content,
  buildProvider,
  reset,
  start,
  persistStream,
  onStreamStart,
  showCancel,
  hideCancel,
  consume,
  renderFallback,
}) {
  const outcome = await runWithEngineFallback(
    settings,
    chain,
    async (type, engine, index) => {
      reset?.(index);
      const { streamId, stream } = await start(engine, type, index);
      if ((await persistStream(streamId, index)) === "superseded") {
        cancelStream(streamId);
        return "superseded";
      }
      onStreamStart?.(streamId);
      showCancel(streamId);
      try {
        await consume(stream, index);
      } finally {
        hideCancel(streamId);
      }
      return "done";
    },
    { content, buildProvider },
  );
  if (outcome.result === "superseded") return "superseded";
  if (outcome.type === "extracted-text") {
    renderFallback(outcome.result.fallbackText);
    return "fallback";
  }
  return "done";
}
