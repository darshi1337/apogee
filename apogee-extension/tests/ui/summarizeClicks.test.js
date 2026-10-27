import test from "node:test";
import assert from "node:assert";

import { readSource, functionBody } from "../helpers/readSource.js";

const appSource = readSource("../../ui/app.js", import.meta.url);

const summarizeBody = functionBody(
  appSource,
  "summarizeActivePage",
  "const EMPTY_ANSWER_MESSAGE",
);
const customBody = functionBody(
  appSource,
  "summarizeCustomContent",
  'document.getElementById("pasteTextBtn")',
);
const askBody = functionBody(
  appSource,
  "submitQuestion",
  "async function checkConnection",
);

function assertGateBeforeFirstAwait(body, gateName) {
  const gate = body.indexOf(`${gateName}.tryStart()`);
  const firstAwait = body.indexOf("await ");
  assert.ok(gate >= 0, `${gateName} must guard the start`);
  assert.ok(firstAwait > gate, `${gateName} must run before the first await`);
  assert.match(body, /if \(!startToken\) return;/);
}

test("summarizeActivePage takes the shared start gate before its first await", () => {
  assertGateBeforeFirstAwait(summarizeBody, "summaryStartGate");
  assert.match(
    summarizeBody,
    /onStreamStart: \(streamId\) => \{[\s\S]*startedStreamId = streamId;[\s\S]*summaryStartGate\.release\(startToken\);/,
  );
  assert.match(
    summarizeBody,
    /summaryStartGate\.release\(startToken\);\s*summaryCancel\.hide\(startedStreamId\);/,
  );
});

test("summarizeCustomContent uses the same start gate (#547)", () => {
  assertGateBeforeFirstAwait(customBody, "summaryStartGate");
  assert.match(
    customBody,
    /onStreamStart: \(streamId\) => \{[\s\S]*startedStreamId = streamId;[\s\S]*summaryStartGate\.release\(startToken\);/,
  );
  assert.match(
    customBody,
    /summaryStartGate\.release\(startToken\);\s*summaryCancel\.hide\(startedStreamId\);/,
  );
});

test("submitQuestion takes its own start gate before its first await", () => {
  assertGateBeforeFirstAwait(askBody, "askStartGate");
  assert.match(
    askBody,
    /onStreamStart: \(streamId\) => \{[\s\S]*startedStreamId = streamId;[\s\S]*askStartGate\.release\(startToken\);/,
  );
  assert.match(
    askBody,
    /askStartGate\.release\(startToken\);\s*askCancel\.hide\(startedStreamId\);/,
  );
});

test("the old boolean guard and cancel wrappers are gone (#547)", () => {
  assert.doesNotMatch(appSource, /isSummarizeStarting/);
  assert.doesNotMatch(
    appSource,
    /showCancelSummarizeButton|hideCancelSummarizeButton/,
  );
  assert.doesNotMatch(appSource, /showCancelAskButton|hideCancelAskButton/);
  assert.match(appSource, /const summaryStartGate = createJobStartGate\(\);/);
  assert.match(appSource, /const askStartGate = createJobStartGate\(\);/);
});
