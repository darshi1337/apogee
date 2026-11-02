import { t } from "../lib/util/i18n.js";
import { REMOTE_PROVIDER_IDS } from "../lib/engines/remoteModels.js";

// This preview only configures the worker. It never makes provider requests or
// adds remote engines to the generation picker. The worker enforces consent.
export async function initRemoteSettings({
  root = globalThis.document,
  sendMessage = (message) => globalThis.chrome.runtime.sendMessage(message),
  translate = t,
  requestConsentPermission = () =>
    process.env.TARGET_BROWSER === "firefox"
      ? globalThis.chrome.permissions.request({
          data_collection: ["authenticationInfo"],
        })
      : Promise.resolve(true),
} = {}) {
  const panels = REMOTE_PROVIDER_IDS.map((provider) => ({
    provider,
    element: root.querySelector(`[data-remote-provider="${provider}"]`),
    state: null,
    busy: false,
    epoch: 0,
  })).filter((panel) => panel.element);
  if (!panels.length) return;

  function controls(panel) {
    const query = (name) =>
      panel.element.querySelector(`[data-remote="${name}"]`);
    return {
      consent: query("consent"),
      key: query("key"),
      save: query("save"),
      revoke: query("revoke"),
      clearKey: query("clear-key"),
      refresh: query("refresh"),
      model: query("model"),
      status: query("status"),
      keyStatus: query("key-status"),
    };
  }

  function canRefresh(state, consentChecked) {
    return (
      state?.consent === true &&
      state?.hasApiKey === true &&
      consentChecked === true
    );
  }

  function statusKeyFor(state) {
    if (!state?.catalog?.models?.length) return "remoteModelsEmpty";
    return state.catalog.stale ? "remoteModelsStale" : "remoteModelsReady";
  }

  function render(panel, statusKey) {
    const c = controls(panel);
    const state = panel.state;
    panel.element.setAttribute("aria-busy", String(panel.busy));
    for (const input of panel.element.querySelectorAll(
      "input, button, select",
    )) {
      input.disabled = panel.busy || !state;
    }
    // Revocation remains available while a catalog request is in flight.
    c.revoke.disabled = state?.consent !== true;
    c.clearKey.disabled = state?.hasApiKey !== true;
    c.refresh.disabled ||= !canRefresh(state, c.consent.checked);
    c.model.disabled ||=
      state?.consent !== true ||
      state?.catalog?.stale === true ||
      !state?.catalog?.models?.length;
    c.keyStatus.textContent = translate(
      state?.hasApiKey ? "remoteKeySaved" : "remoteKeyMissing",
    );
    if (statusKey) c.status.textContent = translate(statusKey);
  }

  function apply(panel, response) {
    const state = response?.providers?.[panel.provider];
    if (
      !state ||
      typeof state.consent !== "boolean" ||
      typeof state.hasApiKey !== "boolean" ||
      !Array.isArray(state.catalog?.models)
    )
      throw new Error("Invalid remote settings response");
    panel.state = state;
    if (state.consent || state.hasApiKey || state.catalog.models.length)
      panel.element.setAttribute("open", "");
    const c = controls(panel);
    c.consent.checked = state.consent;
    c.model.replaceChildren();
    const placeholder = root.createElement("option");
    placeholder.value = "";
    placeholder.textContent = translate("remoteChooseModel");
    c.model.append(placeholder);
    for (const model of state.catalog.models) {
      if (typeof model.id !== "string" || typeof model.label !== "string")
        continue;
      const option = root.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      option.selected = model.id === state.model;
      c.model.append(option);
    }
    render(panel, statusKeyFor(state));
  }

  async function run(panel, action, payload) {
    const interrupts =
      action === "remote-settings-save" &&
      (payload.consent === false || payload.apiKey === "");
    const clearsKey =
      action === "remote-settings-save" &&
      (Object.hasOwn(payload, "apiKey") || payload.consent === false);
    if ((panel.busy && !interrupts) || !panel.state) return;
    const epoch = ++panel.epoch;
    if (payload.consent === false) controls(panel).consent.checked = false;
    panel.busy = true;
    let completed = false;
    render(
      panel,
      action === "remote-models-refresh"
        ? "remoteModelsLoading"
        : "remoteSaving",
    );
    try {
      const response = await sendMessage({
        target: "service-worker",
        action,
        payload,
      });
      if (panel.epoch !== epoch) return;
      if (response?.error) throw new Error("Remote settings request failed");
      apply(panel, response);
      completed = true;
    } catch {
      if (panel.epoch !== epoch) return;
      if (action === "remote-models-refresh") {
        try {
          const response = await sendMessage({
            target: "service-worker",
            action: "remote-settings-get",
          });
          if (panel.epoch !== epoch) return;
          apply(panel, response);
        } catch {
          // Keep the last local view when the worker cannot be read.
        }
        if (panel.epoch !== epoch) return;
        render(
          panel,
          panel.state?.catalog?.models?.length
            ? "remoteModelsRefreshError"
            : "remoteSettingsError",
        );
      } else {
        // Do not echo backend errors: a credential might be included in one.
        render(panel, "remoteSettingsError");
      }
    } finally {
      if (panel.epoch === epoch) {
        panel.busy = false;
        if (completed && clearsKey) controls(panel).key.value = "";
        render(panel);
      }
    }
  }

  for (const panel of panels) {
    const c = controls(panel);
    render(panel, "remoteSettingsLoading");
    c.save.addEventListener("click", async () => {
      if (panel.busy || !panel.state) return;
      const payload = { provider: panel.provider, consent: c.consent.checked };
      if (c.key.value.trim()) payload.apiKey = c.key.value.trim();
      if (payload.consent) {
        // Request Firefox's data permission from the explicit consent gesture.
        // Saving this setting and all provider traffic remain worker-owned.
        panel.busy = true;
        const epoch = ++panel.epoch;
        render(panel, "remoteSaving");
        let granted = false;
        try {
          granted = await requestConsentPermission();
        } catch {
          // A missing or denied permission must never become saved consent.
        }
        if (panel.epoch !== epoch) return;
        panel.busy = false;
        if (!granted) {
          c.key.value = "";
          c.consent.checked = false;
          render(panel, "remotePermissionDenied");
          return;
        }
      }
      void run(panel, "remote-settings-save", payload);
    });
    c.revoke.addEventListener(
      "click",
      () =>
        void run(panel, "remote-settings-save", {
          provider: panel.provider,
          consent: false,
        }),
    );
    c.clearKey.addEventListener(
      "click",
      () =>
        void run(panel, "remote-settings-save", {
          provider: panel.provider,
          apiKey: "",
        }),
    );
    c.refresh.addEventListener("click", () => {
      if (!canRefresh(panel.state, c.consent.checked)) return;
      void run(panel, "remote-models-refresh", { provider: panel.provider });
    });
    c.consent.addEventListener("change", () => {
      // Unchecking immediately blocks refresh; Save or Revoke persists the choice.
      c.refresh.disabled =
        panel.busy || !canRefresh(panel.state, c.consent.checked);
    });
    c.model.addEventListener("change", () => {
      if (
        panel.state?.consent !== true ||
        panel.state?.catalog?.stale === true ||
        !c.model.value
      )
        return;
      void run(panel, "remote-settings-save", {
        provider: panel.provider,
        model: c.model.value,
      });
    });
  }
  try {
    const response = await sendMessage({
      target: "service-worker",
      action: "remote-settings-get",
    });
    if (response?.error) throw new Error("Remote settings unavailable");
    for (const panel of panels) apply(panel, response);
  } catch {
    for (const panel of panels) {
      panel.state = null;
      render(panel, "remoteSettingsError");
    }
  }
}
