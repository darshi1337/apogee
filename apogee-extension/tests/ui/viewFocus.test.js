import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import { functionBody, readSource } from "../helpers/readSource.js";

test("view changes move keyboard focus to a visible control", () => {
  const { document } = parseHTML(
    readSource("../../ui/app.html", import.meta.url),
  );
  const destinations = [
    ["homeView", "summarizeBtn"],
    ["summaryView", "settingsBtn2"],
    ["settingsView", "settingsBackBtn"],
    ["contactView", "contactBackBtn"],
  ];
  const views = Object.fromEntries(
    destinations.map(([id]) => [id, document.getElementById(id)]),
  );

  let activeElement = document.getElementById("settingsBtn");
  Object.defineProperty(document, "activeElement", {
    get: () => activeElement,
  });
  for (const element of document.querySelectorAll(
    "button, textarea, [tabindex]",
  )) {
    element.focus = () => {
      if (!element.closest(".hidden, [hidden]") && !element.disabled) {
        activeElement = element;
      }
    };
  }

  const body = functionBody(
    readSource("../../ui/app.js", import.meta.url),
    "showOnlyView",
    "async function updateSummarizeShortcutHint",
  );
  const showOnlyView = runInNewContext(`(view) => {${body}}`, {
    ...views,
    document,
    resetRemoteQuestionsAction() {},
    setFileUploadError() {},
  });

  for (const [id, control] of [
    ...destinations.slice(1),
    destinations[2],
    destinations[1],
    destinations[0],
  ]) {
    showOnlyView(id);
    assert.equal(activeElement.id, control, `keyboard focus in ${id}`);
    assert.equal(activeElement.closest(".hidden, [hidden]"), null);
    for (const [viewId, element] of Object.entries(views)) {
      assert.equal(element.classList.contains("hidden"), viewId !== id);
    }
  }

  document.getElementById("settingsBtn").focus();
  showOnlyView("homeView");
  assert.equal(
    activeElement.id,
    "settingsBtn",
    "keep focus within the current view",
  );
  const settingsBack = document.getElementById("settingsBackBtn");
  settingsBack.disabled = true;
  showOnlyView("settingsView");
  assert.equal(
    activeElement.id,
    "settingsView",
    "fallback when the preferred control cannot receive focus",
  );
});
