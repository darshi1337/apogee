import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

test("runBackgroundSummarize only calls startLocalHttpStream once for Local Ollama (#151)", async () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );

  // Extract runBackgroundSummarize function body
  const fnMatch = swCode.match(
    /async function runBackgroundSummarize[\s\S]*?\n\}/,
  );
  assert.ok(fnMatch, "runBackgroundSummarize function found");
  const fnBody = fnMatch[0];

  // Count occurrences of startLocalHttpStream calls inside runBackgroundSummarize
  const callMatches = fnBody.match(/startLocalHttpStream\(/g) || [];
  // There should be exactly 2 startLocalHttpStream calls: one for PROVIDERS.LOCAL and one for PROVIDERS.LLAMACPP
  assert.strictEqual(
    callMatches.length,
    2,
    "runBackgroundSummarize should have exactly 2 startLocalHttpStream calls (one for LOCAL, one for LLAMACPP)",
  );

  // In the streamId initialization block, there should be NO startLocalHttpStream call
  const initBlockMatch = fnBody.match(
    /let streamId;[\s\S]*?registerStreamJob\(streamId/,
  );
  assert.ok(initBlockMatch, "streamId initialization block found");
  assert.ok(
    !initBlockMatch[0].includes("startLocalHttpStream("),
    "streamId init block should not call startLocalHttpStream before registerStreamJob",
  );
});

test("runBackgroundSummarize throws UserFacingError for empty-content cases instead of silently returning (#253)", () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );

  const fnMatch = swCode.match(
    /async function runBackgroundSummarize[\s\S]*?\n\}/,
  );
  assert.ok(fnMatch, "runBackgroundSummarize function found");
  const fnBody = fnMatch[0];

  // Every empty-content guard now throws a UserFacingError so the caller's
  // .catch(notifyJobFailed) surfaces it, instead of returning undefined and
  // leaving the waiter hanging.
  const throwCount = (fnBody.match(/throw new UserFacingError\(/g) || [])
    .length;
  assert.ok(
    throwCount >= 5,
    `expected >= 5 'throw new UserFacingError(...)' guards, found ${throwCount}`,
  );

  // The old silent-return pattern must be gone.
  assert.ok(
    !fnBody.includes("notifyNothingToSummarize"),
    "notifyNothingToSummarize should no longer be called",
  );
  assert.ok(
    !/if \(notifyOnFinish\)/.test(fnBody),
    "no `if (notifyOnFinish)` empty-content guard should remain",
  );
});

test("runBackgroundSummarize still threads notifyOnFinish for the success notification (#253)", () => {
  const swCode = fs.readFileSync(
    new URL("../../background/service-worker.js", import.meta.url),
    "utf-8",
  );

  const fnMatch = swCode.match(
    /async function runBackgroundSummarize[\s\S]*?\n\}/,
  );
  assert.ok(fnMatch, "runBackgroundSummarize function found");
  const fnBody = fnMatch[0];

  // notifyOnFinish is still accepted and passed into the finalize object so the
  // success-path completion notification keeps working.
  assert.ok(
    fnBody.includes("{ notifyOnFinish, selectionText } = {}"),
    "runBackgroundSummarize should still accept notifyOnFinish",
  );
  assert.ok(
    /\n\s*notifyOnFinish,\n/.test(fnBody),
    "notifyOnFinish should still be threaded into the finalize object",
  );

  // The orphaned helper should be removed from the module entirely.
  assert.ok(
    !swCode.includes("function notifyNothingToSummarize"),
    "the orphaned notifyNothingToSummarize helper should be removed",
  );
});
