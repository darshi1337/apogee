import test from "node:test";
import assert from "node:assert/strict";
import { readSource } from "../helpers/readSource.js";

const source = readSource("../../offscreen/offscreen.js", import.meta.url);

function getSection(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `Missing: ${start}`);
  assert.notEqual(endIndex, -1, `Missing: ${end}`);

  return source.slice(startIndex, endIndex);
}

test("wires the idle disposer to the engine lock and unload path", () => {
  const section = getSection(
    "const idleDisposer = createIdleDisposer({",
    "let _webllm = null;",
  );

  assert.match(section, /acquireLock/);
  assert.match(section, /lockTimeoutMs: ENGINE_LOCK_TIMEOUT_MS/);
  assert.match(section, /dispose: unloadEngineNow/);
});

test("schedules idle disposal after engine usage", () => {
  const section = getSection(
    "async function withEngine(",
    "// WebLLM's engine can report",
  );

  assert.match(section, /idleDisposer\.cancel\(\)/);
  assert.match(section, /idleDisposer\.schedule\(\)/);
});

test("cancels idle disposal when the engine is reused", () => {
  const section = getSection(
    "async function ensureEngine(",
    "async function withEngine(",
  );

  assert.match(section, /idleDisposer\.cancel\(\)/);
});

test("manual reset cancels the idle timer and unloads the engine", () => {
  const section = getSection(
    "async function resetEngineState(",
    "async function withEngine(",
  );

  assert.match(section, /idleDisposer\.cancel\(\)/);
  assert.match(section, /await unloadEngineNow\(\)/);
});

test("stream errors do not reset the engine outside its lock", () => {
  const section = getSection(
    "  } catch (err) {\n    if (stream.cancelled) return;",
    "  } finally {\n    scheduleStreamCleanup(streamId);",
  );

  assert.doesNotMatch(section, /resetEngineState/);
});
