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

test("schedules idle disposal after engine usage", () => {
  const section = getSection("async function withEngine(", "async function ");

  assert.match(section, /scheduleEngineIdleDispose\(\)/);
});

test("cancels idle disposal when engine is reused", () => {
  const section = getSection("async function ensureEngine(", "async function ");

  assert.match(section, /cancelEngineIdleDispose\(\)/);
});

test("waits for the lock before disposing the engine", () => {
  const section = getSection(
    "function scheduleEngineIdleDispose(",
    "async function ",
  );

  assert.match(section, /acquireLock/);
  assert.match(section, /await unloadEngineNow\(\)/);
  assert.match(section, /release\?\.\(\)/);
});

test("prevents stale idle timers from disposing a reused engine", () => {
  const section = getSection(
    "function scheduleEngineIdleDispose(",
    "async function ",
  );

  assert.match(section, /engineIdleGeneration/);
  assert.match(section, /generation !== engineIdleGeneration/);
});

test("manual disposal cancels the idle timer and unloads the engine", () => {
  const section = getSection(
    "async function disposeEngineNow(",
    "function getEngineStatus(",
  );

  assert.match(section, /cancelEngineIdleDispose\(\)/);
  assert.match(section, /acquireLock/);
  assert.match(section, /await unloadEngineNow\(\)/);
  assert.match(section, /release\?\.\(\)/);
});
