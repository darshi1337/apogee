import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const popupHtmlPath = new URL("../../ui/app.html", import.meta.url);
const popupHtmlRaw = readFileSync(popupHtmlPath, "utf8");

test("app.html parses into valid DOM structure", () => {
  const { document } = parseHTML(popupHtmlRaw);
  assert.ok(document.body, "app.html body must exist");
  assert.ok(
    document.querySelector(".container"),
    "Container element must exist",
  );
});

test("app.html includes all primary view panels", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredViews = [
    "homeView",
    "summaryView",
    "settingsView",
    "contactView",
  ];

  requiredViews.forEach((id) => {
    const view = document.getElementById(id);
    assert.ok(view, `Application view #${id} must exist in app.html`);
  });
});

test("app.html includes key UI action buttons", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredButtons = [
    "summarizeBtn",
    "askBtn",
    "openSidePanelBtn",
    "openSidePanelBtn2",
    "openSidePanelBtn3",
    "openSidePanelBtn4",
    "settingsBtn",
  ];

  requiredButtons.forEach((id) => {
    const btn = document.getElementById(id);
    assert.ok(btn, `Action button #${id} must exist in app.html`);
  });
});

test("side panel controls preserve Chrome's native panel chrome", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const sidePanelButtons = document.querySelectorAll(".open-side-panel-btn");

  assert.strictEqual(sidePanelButtons.length, 4);
  sidePanelButtons.forEach((button) => {
    assert.strictEqual(button.getAttribute("aria-label"), "Open in side panel");
    assert.ok(button.querySelector('[data-ico="panel"]'));
    assert.ok(button.querySelector('[data-ico="close"]'));
  });
  assert.ok(document.getElementById("sidePanelThemeToggleBtn"));
  assert.strictEqual(
    document.querySelector(".side-panel-hero h1")?.textContent,
    "TL;DR",
  );
});

test("app.html includes summary text container and chat controls", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredElements = [
    "summaryText",
    "questionInput",
    "sendBtn",
    "summaryCard",
  ];

  requiredElements.forEach((id) => {
    const el = document.getElementById(id);
    assert.ok(el, `UI element #${id} must exist in app.html`);
  });
});

test("app.html includes settings configuration controls", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredSettings = [
    "summaryLanguageSelect",
    "customInstructionsInput",
    "privateHostsInput",
    "clearDataBtn",
  ];

  requiredSettings.forEach((id) => {
    const el = document.getElementById(id);
    assert.ok(el, `Settings control #${id} must exist in app.html`);
  });
});

test("app.html includes a decorative wordmark for the empty state (#243)", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const mark = document.getElementById("wordmarkEmpty");
  assert.ok(mark, "Empty-state wordmark #wordmarkEmpty must exist");
  assert.strictEqual(
    mark.getAttribute("aria-hidden"),
    "true",
    "Wordmark must be hidden from assistive tech",
  );
  assert.strictEqual(mark.textContent.trim(), "apogee");
  assert.ok(
    mark.classList.contains("hidden"),
    "Wordmark starts hidden until past summaries load",
  );
});

test("app.html includes a bulk export button for past summaries (#244)", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const btn = document.getElementById("exportAllJsonBtn");
  assert.ok(btn, "Bulk export button #exportAllJsonBtn must exist");
  assert.strictEqual(btn.textContent.trim(), "Export all (.json)");
  assert.strictEqual(
    btn.getAttribute("data-i18n-aria-label"),
    "exportAllJsonAria",
    "Bulk export button must carry an i18n aria-label key",
  );
});
