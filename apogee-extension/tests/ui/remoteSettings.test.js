import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { initRemoteSettings } from "../../ui/remoteSettings.js";
import { REMOTE_PROVIDER_IDS } from "../../lib/engines/remoteModels.js";

const html = readFileSync(
  new URL("../../ui/app.html", import.meta.url),
  "utf8",
);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function view(overrides = {}) {
  const provider = {
    consent: false,
    hasApiKey: false,
    model: "",
    catalog: { models: [], stale: false, refreshedAt: null },
    ...overrides,
  };
  return {
    providers: {
      openrouter: structuredClone(provider),
      opencode: structuredClone(provider),
    },
  };
}
async function setup(
  initial = view(),
  respond = () => initial,
  permission = async () => true,
) {
  const { document, window } = parseHTML(html);
  const calls = [];
  await initRemoteSettings({
    root: document,
    translate: (key) => key,
    requestConsentPermission: permission,
    sendMessage: async (message) => {
      calls.push(message);
      return calls.length === 1 ? initial : respond(message);
    },
  });
  const panel = (provider = "openrouter") =>
    document.querySelector(`[data-remote-provider="${provider}"]`);
  const control = (name, provider) =>
    panel(provider).querySelector(`[data-remote="${name}"]`);
  const fire = (name, type = "click", provider) =>
    control(name, provider).dispatchEvent(new window.Event(type));
  return { document, calls, panel, control, fire };
}

test("startup reads only local settings and remote providers are absent from the engine picker", async () => {
  const { document, calls, control } = await setup();
  assert.deepEqual(calls, [
    { target: "service-worker", action: "remote-settings-get" },
  ]);
  assert.equal(control("key").type, "password");
  assert.equal(control("key").getAttribute("autocomplete"), "off");
  assert.equal(control("refresh").disabled, true);
  assert.equal(control("status").textContent, "remoteModelsEmpty");
  assert.equal(
    document.querySelector('input[type="radio"][value="openrouter"]'),
    null,
  );
  assert.equal(
    document.querySelector('input[type="radio"][value="opencode"]'),
    null,
  );
  assert.match(
    document.querySelector("#remoteSetupTitle").textContent,
    /preview/,
  );
});

test("empty catalogs report empty even when the stale flag is set", async () => {
  const { control } = await setup(
    view({ catalog: { models: [], stale: true, refreshedAt: null } }),
  );
  assert.equal(control("status").textContent, "remoteModelsEmpty");
});

test("refresh cannot send before persisted provider consent and key", async () => {
  const { calls, fire, control } = await setup();
  control("consent").checked = true;
  fire("refresh");
  await tick();
  assert.equal(calls.length, 1);
});

test("explicit save carries key and consent; key field clears; refresh stays provider scoped", async () => {
  const approved = view({ consent: true, hasApiKey: true });
  const { calls, control, fire } = await setup(view(), () => approved);
  control("consent").checked = true;
  control("key").value = "secret-key";
  fire("save");
  await tick();
  assert.deepEqual(calls[1], {
    target: "service-worker",
    action: "remote-settings-save",
    payload: {
      provider: "openrouter",
      consent: true,
      apiKey: "secret-key",
    },
  });
  assert.equal(control("key").value, "");
  assert.equal(control("refresh").disabled, false);
  assert.equal(control("refresh", "opencode").disabled, true);
  fire("refresh");
  await tick();
  assert.deepEqual(calls[2], {
    target: "service-worker",
    action: "remote-models-refresh",
    payload: { provider: "openrouter" },
  });
});

test("a typed key survives refresh", async () => {
  const approved = view({ consent: true, hasApiKey: true });
  const { control, fire } = await setup(
    view({ consent: true, hasApiKey: true }),
    () => approved,
  );
  control("key").value = "pending-key";
  fire("refresh");
  await tick();
  assert.equal(control("key").value, "pending-key");
});

test("a typed key survives a failed save", async () => {
  const { control, fire } = await setup(view(), () => ({ error: "secret" }));
  control("consent").checked = true;
  control("key").value = "pending-key";
  fire("save");
  await tick();
  assert.equal(control("key").value, "pending-key");
});

test("browser permission denial does not persist consent and leaves refresh blocked", async () => {
  const { calls, control, fire } = await setup(
    view(),
    undefined,
    async () => false,
  );
  control("consent").checked = true;
  control("key").value = "secret-key";
  fire("save");
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(control("refresh").disabled, true);
  assert.equal(control("consent").checked, false);
  assert.equal(control("key").value, "");
  assert.equal(control("status").textContent, "remotePermissionDenied");
});

test("stale catalog labels remain inert and cannot be selected", async () => {
  const initial = view({
    consent: true,
    hasApiKey: true,
    model: "model-a",
    catalog: {
      stale: true,
      models: [
        {
          id: "model-a",
          label: "<img src=x onerror=alert(1)>",
          contextTokens: 1000,
        },
      ],
    },
  });
  const { calls, control, fire } = await setup(initial);
  assert.equal(control("status").textContent, "remoteModelsStale");
  assert.equal(control("model").disabled, true);
  assert.equal(control("model").querySelector("img"), null);
  assert.match(control("model").textContent, /<img/);
  fire("model", "change");
  await tick();
  assert.equal(calls.length, 1);
});

test("fresh catalog models are selectable and save provider scoped", async () => {
  const initial = view({
    consent: true,
    hasApiKey: true,
    model: "model-a",
    catalog: {
      stale: false,
      models: [{ id: "model-a", label: "Model A", contextTokens: 1000 }],
    },
  });
  const { calls, control, fire } = await setup(initial);
  assert.equal(control("model").disabled, false);
  fire("model", "change");
  await tick();
  assert.deepEqual(calls[1].payload, {
    provider: "openrouter",
    model: "model-a",
  });
});

test("revoke and key removal are distinct explicit actions", async () => {
  const initial = view({ consent: true, hasApiKey: true });
  const { calls, fire } = await setup(initial);
  fire("revoke");
  await tick();
  assert.deepEqual(calls[1].payload, {
    provider: "openrouter",
    consent: false,
  });
  fire("clear-key");
  await tick();
  assert.deepEqual(calls[2].payload, { provider: "openrouter", apiKey: "" });
});

test("failed model saves report a save error, not a refresh error", async () => {
  const initial = view({
    consent: true,
    hasApiKey: true,
    model: "model-a",
    catalog: {
      stale: false,
      models: [{ id: "model-a", label: "Model A", contextTokens: 1000 }],
    },
  });
  const { control, fire } = await setup(initial, () => ({ error: "secret" }));
  fire("model", "change");
  await tick();
  assert.equal(control("status").textContent, "remoteSettingsError");
});

test("loading is announced, duplicate refresh is blocked, errors do not expose backend text", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { control, panel, calls, fire } = await setup(
    view({ consent: true, hasApiKey: true }),
    () => pending,
  );
  fire("refresh");
  assert.equal(control("status").textContent, "remoteModelsLoading");
  assert.equal(panel().getAttribute("aria-busy"), "true");
  assert.equal(control("refresh").disabled, true);
  fire("refresh");
  assert.equal(calls.length, 2);
  finish({ error: "secret-key" });
  await tick();
  assert.equal(panel().getAttribute("aria-busy"), "false");
  assert.equal(control("status").textContent, "remoteSettingsError");
  assert.doesNotMatch(panel().textContent, /secret-key/);
});

test("both remote providers expose the same control set", () => {
  const { document } = parseHTML(html);
  const panels = REMOTE_PROVIDER_IDS.map((provider) =>
    document.querySelector(`[data-remote-provider="${provider}"]`),
  );
  const controls = (panel) =>
    [...panel.querySelectorAll("[data-remote]")]
      .map((element) => element.getAttribute("data-remote"))
      .sort();
  assert.deepEqual(controls(panels[0]), controls(panels[1]));
});
test("invalid startup response fails closed", async () => {
  const { calls, control, fire } = await setup({ error: "unavailable" });
  assert.equal(control("save").disabled, true);
  assert.equal(control("refresh").disabled, true);
  assert.equal(control("status").textContent, "remoteSettingsError");
  fire("save");
  fire("refresh");
  await tick();
  assert.equal(calls.length, 1);
});

test("revoking during refresh prevents its late response from restoring consent", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const approved = view({ consent: true, hasApiKey: true });
  const revoked = view({ consent: false, hasApiKey: true });
  const { control, calls, fire } = await setup(approved, (message) =>
    message.action === "remote-models-refresh" ? pending : revoked,
  );
  fire("refresh");
  assert.equal(control("revoke").disabled, false);
  fire("revoke");
  await tick();
  assert.equal(calls[2].payload.consent, false);
  assert.equal(control("consent").checked, false);
  finish(approved);
  await tick();
  assert.equal(control("consent").checked, false);
  assert.equal(control("refresh").disabled, true);
});

test("failed refresh rereads retained catalog and announces stale availability", async () => {
  const good = view({ consent: true, hasApiKey: true });
  const retained = view({
    consent: true,
    hasApiKey: true,
    catalog: {
      stale: true,
      models: [{ id: "saved", label: "Last good model", contextTokens: 1000 }],
    },
  });
  const { control, calls, fire } = await setup(good, (message) =>
    message.action === "remote-models-refresh"
      ? { error: "offline" }
      : retained,
  );
  fire("refresh");
  await tick();
  assert.equal(calls[2].action, "remote-settings-get");
  assert.match(control("model").textContent, /Last good model/);
  assert.equal(control("status").textContent, "remoteModelsRefreshError");
});
