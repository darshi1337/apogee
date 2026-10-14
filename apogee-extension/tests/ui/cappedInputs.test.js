import test from "node:test";
import assert from "node:assert";
import { parseHTML } from "linkedom";

import {
  setInputMaxLength,
  syncCappedInputMaxLengths,
  updateCappedInputCount,
  wireCappedSettingsInput,
} from "../../ui/cappedInputs.js";

function makeInput(value = "") {
  const { document, window } = parseHTML("<input><span></span>");
  const input = document.querySelector("input");
  const count = document.querySelector("span");
  input.value = value;
  return { document, window, input, count };
}

function fire(window, el, name) {
  el.dispatchEvent(new window.Event(name, { bubbles: true }));
}

test("setInputMaxLength syncs the cap and ignores a missing input (#320)", () => {
  const { input } = makeInput();
  setInputMaxLength(input, 42);
  assert.equal(input.maxLength, 42);
  assert.doesNotThrow(() => setInputMaxLength(null, 42));
});

test("syncCappedInputMaxLengths wires every pair (#320)", () => {
  const a = makeInput();
  const b = makeInput();
  syncCappedInputMaxLengths([
    [a.input, 10],
    [b.input, 20],
  ]);
  assert.equal(a.input.maxLength, 10);
  assert.equal(b.input.maxLength, 20);
});

test("updateCappedInputCount renders length over cap (#320)", () => {
  const { input, count } = makeInput("hello");
  updateCappedInputCount(input, count, 100);
  assert.equal(count.textContent, "5 / 100");
  assert.doesNotThrow(() => updateCappedInputCount(null, null, 100));
});

test("typing updates the counter and autosaves the trimmed value", async () => {
  const { window, input, count } = makeInput("  padded  ");
  const saved = [];
  wireCappedSettingsInput(
    input,
    count,
    100,
    "customInstructions",
    async (patch) => {
      saved.push(patch);
    },
  );
  input.value = "  padded value  ";
  fire(window, input, "input");
  assert.equal(count.textContent, "16 / 100");
  fire(window, input, "blur");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepStrictEqual(saved, [{ customInstructions: "padded value" }]);
});

test("blur saves once even after typing first", async () => {
  const { window, input, count } = makeInput("x");
  const saved = [];
  wireCappedSettingsInput(input, count, 3, "privateHosts", async (patch) => {
    saved.push(patch);
  });
  fire(window, input, "input");
  fire(window, input, "blur");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(saved.length, 1);
  assert.deepStrictEqual(saved[0], { privateHosts: "x" });
});

test("a missing input never wires listeners", () => {
  assert.doesNotThrow(() =>
    wireCappedSettingsInput(null, null, 10, "k", async () => {}),
  );
});
