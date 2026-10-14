import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import {
  CUSTOM_INSTRUCTIONS_MAX_CHARS,
  MODEL_NAME_MAX_CHARS,
  PRIVATE_HOSTS_MAX_CHARS,
} from "../../lib/constants.js";
import { FOCUS_KEYWORD_MAX_CHARS } from "../../lib/summarize/prompts.js";

// #161: a per-page focus keyword input. Behavior lives in the importable
// ui/focusKeyword.js and ui/cappedInputs.js modules, tested directly in
// focusKeyword.test.js and cappedInputs.test.js. What remains here runs
// against the real markup: the input exists and its caps match the JS
// constants, so bumping a constant fails here instead of silently
// drifting. Listener wiring in app.js stays thin one-line delegation by
// review; it has no behavior left to assert once the modules own the
// decisions.

const appHtmlPath = new URL("../../ui/app.html", import.meta.url);
const appHtmlRaw = readFileSync(appHtmlPath, "utf8");

test("app.html declares the focus keyword input with the documented cap (#161)", () => {
  const { document } = parseHTML(appHtmlRaw);
  const input = document.getElementById("focusKeywordInput");
  assert.ok(input, "#focusKeywordInput must exist in app.html");
  assert.strictEqual(input.getAttribute("type"), "text");
  // #320: assert against the JS cap, not a literal, so bumping
  // FOCUS_KEYWORD_MAX_CHARS fails here instead of silently drifting.
  assert.strictEqual(
    input.getAttribute("maxlength"),
    String(FOCUS_KEYWORD_MAX_CHARS),
  );
});

test("capped settings inputs match their JS caps (#320)", () => {
  const { document } = parseHTML(appHtmlRaw);
  const customInstructions = document.getElementById("customInstructionsInput");
  assert.ok(customInstructions, "#customInstructionsInput must exist");
  assert.strictEqual(
    customInstructions.getAttribute("maxlength"),
    String(CUSTOM_INSTRUCTIONS_MAX_CHARS),
  );
  const privateHosts = document.getElementById("privateHostsInput");
  assert.ok(privateHosts, "#privateHostsInput must exist");
  assert.strictEqual(
    privateHosts.getAttribute("maxlength"),
    String(PRIVATE_HOSTS_MAX_CHARS),
  );
  const llamaModel = document.getElementById("llamaModelInput");
  assert.ok(llamaModel, "#llamaModelInput must exist");
  assert.strictEqual(
    llamaModel.getAttribute("maxlength"),
    String(MODEL_NAME_MAX_CHARS),
  );
});
