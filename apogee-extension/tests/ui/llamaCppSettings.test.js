import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

import { PROVIDERS, DEFAULT_SETTINGS } from "../../lib/constants.js";
import { formatDiagnosticSettings } from "../../lib/util/diagnostics.js";

const popupHtml = readFileSync(
  new URL("../../ui/app.html", import.meta.url),
  "utf8",
);
const popupJs = readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf8",
);

test("app.html offers llama.cpp in the provider list", () => {
  const { document } = parseHTML(popupHtml);
  const radio = document.querySelector(
    'input[name="provider"][value="llamacpp"]',
  );
  assert.ok(radio, "a provider radio with value llamacpp must exist");
  assert.equal(
    radio.getAttribute("value"),
    PROVIDERS.LLAMACPP,
    "the radio value must match the PROVIDERS entry the settings are keyed by",
  );
});

test("app.html carries the llama.cpp settings fields", () => {
  const { document } = parseHTML(popupHtml);
  for (const id of [
    "llamaSettingsCard",
    "llamaModelsCard",
    "llamaHostInput",
    "llamaApiKeyInput",
    "llamaModelInput",
    "llamaModelStatus",
  ]) {
    assert.ok(document.getElementById(id), `#${id} must exist in app.html`);
  }
});

// The model is typed or auto-filled, not chosen: llama-server loads exactly one model at launch, so there is no list to render.
test("the llama.cpp model control is a text field, not a radio list", () => {
  const { document } = parseHTML(popupHtml);
  const input = document.getElementById("llamaModelInput");
  assert.equal(input.tagName.toLowerCase(), "input");
  assert.equal(input.getAttribute("type"), "text");
});

test("the API key field is masked and kept out of autofill", () => {
  const { document } = parseHTML(popupHtml);
  const input = document.getElementById("llamaApiKeyInput");
  assert.equal(
    input.getAttribute("type"),
    "password",
    "an API key must not be rendered in clear text",
  );
  assert.equal(input.getAttribute("autocomplete"), "off");
});

test("the llama.cpp cards start hidden, like the other provider cards", () => {
  const { document } = parseHTML(popupHtml);
  for (const id of ["llamaSettingsCard", "llamaModelsCard"]) {
    assert.ok(
      document.getElementById(id).className.includes("hidden"),
      `#${id} must be hidden until llama.cpp is the selected provider`,
    );
  }
});

test("the llama.cpp cards reuse existing card and field classes", () => {
  const { document } = parseHTML(popupHtml);
  assert.ok(
    document
      .getElementById("llamaSettingsCard")
      .className.includes("settings-card"),
  );
  assert.ok(
    document.getElementById("llamaHostInput").closest(".settings-field"),
    "the host input must sit in a .settings-field like the Ollama one",
  );
});

test("app.js toggles the llama.cpp cards on the provider", () => {
  assert.match(popupJs, /PROVIDERS\.LLAMACPP/);
  assert.match(popupJs, /llamaSettingsCard\?\.classList\.toggle\("hidden"/);
  assert.match(popupJs, /llamaModelsCard\?\.classList\.toggle\("hidden"/);
});

// Auto-fill must only touch an empty field, so a name the user typed and a name detected earlier both survive the next health check.
test("app.js only auto-fills the model field when it is empty", () => {
  const guard =
    /if \(detected\.length > 0 && !llamaModelInput\.value\.trim\(\)\)/;
  assert.match(popupJs, guard, "auto-fill must be guarded on an empty field");
});

test("the settings keys the UI writes are the ones that ship as defaults", () => {
  for (const key of ["llamaHost", "llamaModel", "llamaApiKey"]) {
    assert.ok(
      key in DEFAULT_SETTINGS,
      `${key} must exist in DEFAULT_SETTINGS or diagnostics will not report it`,
    );
    assert.match(popupJs, new RegExp(`saveSettings\\(\\{ ${key}`));
  }
});

test("a bug report reports the API key's presence, never its value", () => {
  const report = formatDiagnosticSettings({
    ...DEFAULT_SETTINGS,
    llamaApiKey: "a-real-looking-credential",
    llamaHost: "http://192.168.1.50:8080",
  });
  assert.ok(
    !report.includes("a-real-looking-credential"),
    "the API key must never appear in a copied diagnostics report",
  );
  assert.match(report, /llamaApiKey: set/);
  // A host outside loopback names a machine on the user's network.
  assert.ok(!report.includes("192.168.1.50"));
  assert.match(report, /llamaHost: custom host, port 8080/);
});

test("an unset key and a loopback host are reported plainly", () => {
  const report = formatDiagnosticSettings(DEFAULT_SETTINGS);
  assert.match(report, /llamaApiKey: unset/);
  assert.match(report, /llamaHost: http:\/\/127\.0\.0\.1:8080/);
});
