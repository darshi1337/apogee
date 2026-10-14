import test from "node:test";
import assert from "node:assert";
import { parseHTML } from "linkedom";

import { renderEffectiveConfig } from "../../ui/effectiveConfig.js";
import { getRedactedSettings } from "../../lib/util/diagnostics.js";
import { DEFAULT_SETTINGS } from "../../lib/constants.js";

function makeContainer() {
  const { document } = parseHTML("<div></div>");
  return { document, container: document.querySelector("div") };
}

test("renders one row per setting with defaults marked (#416)", () => {
  const { container } = makeContainer();
  renderEffectiveConfig(
    container,
    getRedactedSettings({ ...DEFAULT_SETTINGS }),
  );
  const keys = [...container.querySelectorAll("dt")].map(
    (el) => el.textContent,
  );
  assert.deepStrictEqual(keys, Object.keys(DEFAULT_SETTINGS));
  const values = [...container.querySelectorAll("dd")].map(
    (el) => el.textContent,
  );
  assert.ok(values.every((v) => v.endsWith("(default)")));
});

test("changed values render without the default mark (#416)", () => {
  const { container } = makeContainer();
  renderEffectiveConfig(
    container,
    getRedactedSettings({ ...DEFAULT_SETTINGS, responseFormat: "sentences" }),
  );
  const rows = [...container.querySelectorAll("dt")].map((dt, i) => [
    dt.textContent,
    container.querySelectorAll("dd")[i].textContent,
  ]);
  const format = rows.find(([k]) => k === "responseFormat");
  assert.equal(format[1], "sentences");
});

test("secret values never reach the DOM (#416)", () => {
  const { container } = makeContainer();
  renderEffectiveConfig(
    container,
    getRedactedSettings({ ...DEFAULT_SETTINGS, llamaApiKey: "sk-live-secret" }),
  );
  assert.ok(!container.textContent.includes("sk-live-secret"));
  const rows = [...container.querySelectorAll("dt")].map((dt, i) => [
    dt.textContent,
    container.querySelectorAll("dd")[i].textContent,
  ]);
  assert.ok(rows.find(([k]) => k === "llamaApiKey")[1].startsWith("set"));
});

test("values render as text, never HTML (#416)", () => {
  const { container } = makeContainer();
  renderEffectiveConfig(container, [
    {
      key: "customInstructions",
      value: "<img src=x onerror=alert(1)>",
      isDefault: false,
    },
  ]);
  assert.equal(container.querySelectorAll("img").length, 0);
  assert.ok(container.querySelector("dd").textContent.includes("<img src=x"));
});

test("a missing container renders nothing and does not throw (#416)", () => {
  assert.doesNotThrow(() => renderEffectiveConfig(null, []));
});
