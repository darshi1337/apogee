import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const body = source.match(
  /async function restoreSuggestedPrompts\([\s\S]*?\n}\n/,
)[0];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function setup(stored = {}) {
  const sends = [];
  const button = { classList: { add() {}, remove() {} } };
  const restore = new AsyncFunction(
    "document",
    "chrome",
    "isRemoteProvider",
    "showSummaryContext",
    "setSuggestedQuestionsLoading",
    "startSuggestedQuestionsBg",
    "t",
    "announce",
    `${body}; return restoreSuggestedPrompts(arguments[8]);`,
  );
  return {
    button,
    sends,
    run: (overrides = {}) =>
      restore(
        { getElementById: () => button },
        {
          storage: { local: { get: async () => stored } },
          runtime: {
            sendMessage: async (message) => {
              sends.push(message);
              return { started: true, promptsCacheKey: "worker-key" };
            },
          },
        },
        (provider) => ["openrouter", "opencode"].includes(provider),
        () => {},
        () => {},
        () => {
          throw new Error("Unexpected automatic generation");
        },
        (key) => key,
        () => {},
        {
          promptsCacheKey: "remote-key",
          tab: { id: 42, title: "Page", url: "https://example.com" },
          summary: "Saved summary",
          settings: { provider: "openrouter" },
          ...overrides,
        },
      ),
  };
}
test("remote restore reads existing questions without generation", async () => {
  const { run, sends } = setup({ "remote-key": ["Cached?"] });
  await run();
  assert.deepEqual(sends, []);
});
test("uncached remote restore transmits only after explicit question action", async () => {
  const { run, button, sends } = setup();
  await run();
  assert.deepEqual(sends, []);
  assert.equal(typeof button.onclick, "function");
  await button.onclick();
  assert.equal(sends.length, 1);
  assert.equal(sends[0].action, "remote-suggest-questions");
  assert.equal(sends[0].payload.summary, "Saved summary");
  assert.equal(sends[0].payload.tabId, 42);
});
test("multi-tab restore also waits for explicit action and identifies owning tab", async () => {
  const { run, button, sends } = setup();
  await run({ pageType: "multi-tab" });
  assert.deepEqual(sends, []);
  await button.onclick();
  assert.equal(sends[0].payload.pageType, "multi-tab");
});
test("explicit restored selection preserves its selected-text identity", async () => {
  const { run, button, sends } = setup();
  await run({
    pageType: "selection",
    selectionText: "Only this selected passage",
  });
  await button.onclick();
  assert.equal(sends[0].payload.selectionText, "Only this selected passage");
});
test("view reset clears the previous summary's remote generation action", () => {
  const button = {
    onclick() {},
    classList: {
      add(name) {
        this.hidden = name === "hidden";
      },
    },
  };
  const resetBody = source.match(
    /function resetRemoteQuestionsAction\([\s\S]*?\n}\n/,
  )[0];
  new Function("document", `${resetBody}; resetRemoteQuestionsAction();`)({
    getElementById: () => button,
  });
  assert.equal(button.onclick, null);
  assert.equal(button.classList.hidden, true);
});
