import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const html = readFileSync(
  new URL("../../ui/app.html", import.meta.url),
  "utf8",
);

const { document } = parseHTML(html);

function labelElements(controlID) {
  const control = document.getElementById(controlID);
  assert.ok(control, `#${controlID} should exist`);
  const ids = control.getAttribute("aria-labelledby").split(" ");
  return ids.map((id) => document.getElementById(id));
}

test("language picker is named by its card title", () => {
  const labels = labelElements("summaryLanguageSelect");
  assert.strictEqual(labels.length, 1);
  assert.strictEqual(labels[0].id, "summaryLanguageTitle");
  assert.strictEqual(labels[0].getAttribute("data-i18n"), "summaryLanguage");
});

test("custom instructions textarea is named by its card title", () => {
  const labels = labelElements("customInstructionsInput");
  assert.strictEqual(labels.length, 1);
  assert.strictEqual(labels[0].id, "customInstructionsTitle");
  assert.strictEqual(labels[0].getAttribute("data-i18n"), "customInstructions");
});

test("private hosts textarea is named by the Privacy title and its hint", () => {
  const labels = labelElements("privateHostsInput");
  assert.strictEqual(labels.length, 2);
  assert.strictEqual(labels[0].id, "privacyTitle");
  assert.strictEqual(labels[0].getAttribute("data-i18n"), "privacy");
  assert.strictEqual(labels[1].id, "privateHostsHint");
  assert.strictEqual(labels[1].getAttribute("data-i18n"), "privateHostsHint");
});
