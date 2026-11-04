import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

const { chrome, getMessageListeners } = createExtensionApiMock({
  settings: {
    provider: "local",
    openrouterConsent: true,
    openrouterApiKey: "router-secret",
    opencodeConsent: true,
    opencodeApiKey: "code-secret",
  },
});
globalThis.chrome = chrome;
await import("../../background/service-worker.js");
const router = getMessageListeners()[0];
const sender = {
  id: chrome.runtime.id,
  url: chrome.runtime.getURL("ui/app.html"),
};
const dispatch = (action, payload) =>
  new Promise((resolve) =>
    router({ target: "service-worker", action, payload }, sender, resolve),
  );

test("worker denies remote setup and generation actions from content scripts and foreign extensions", () => {
  let replies = 0;
  for (const action of [
    "remote-settings-get",
    "remote-settings-save",
    "remote-models-refresh",
    "remote-stream",
  ]) {
    for (const untrusted of [
      { ...sender, tab: { id: 1 }, url: "https://example.com/" },
      { ...sender, url: undefined },
      { ...sender, url: "https://example.com/ui/app.html" },
      { id: "foreign-extension" },
    ]) {
      assert.equal(
        router(
          {
            target: "service-worker",
            action,
            payload: { provider: "openrouter" },
          },
          untrusted,
          () => replies++,
        ),
        false,
      );
    }
  }
  assert.equal(replies, 0);
});

test("worker accepts its own settings tab while retaining content-script restrictions", async () => {
  const view = await new Promise((resolve) => {
    const result = router(
      { target: "service-worker", action: "remote-settings-get" },
      { ...sender, tab: { id: 1 }, url: `${sender.url}?surface=side-panel` },
      resolve,
    );
    assert.equal(result, true);
  });
  assert.equal(view.providers.openrouter.hasApiKey, true);
});

test("worker accepts non-remote actions from its own UI page in a tab", async () => {
  const audit = await new Promise((resolve) => {
    const result = router(
      { target: "service-worker", action: "get-activity-audit" },
      { ...sender, tab: { id: 1 }, url: `${sender.url}?surface=side-panel` },
      resolve,
    );
    assert.equal(result, true);
  });
  assert.equal(typeof audit, "object");
});

test("worker still denies non-remote actions from content scripts", () => {
  let replies = 0;
  const result = router(
    { target: "service-worker", action: "get-activity-audit" },
    { ...sender, tab: { id: 1 }, url: "https://example.com/" },
    () => replies++,
  );
  assert.equal(result, false);
  assert.equal(replies, 0);
});

test("worker returns redacted settings and rejects unknown presets or host/key refresh overrides", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("must not fetch");
  };
  const view = await dispatch("remote-settings-get");
  assert.equal(view.providers.openrouter.hasApiKey, true);
  assert.ok(!JSON.stringify(view).includes("router-secret"));
  assert.ok(!JSON.stringify(view).includes("code-secret"));
  for (const payload of [
    { provider: "https://evil.test" },
    { provider: "openrouter", host: "https://evil.test" },
    { provider: "opencode", apiKey: "injected" },
  ])
    assert.equal(
      typeof (await dispatch("remote-models-refresh", payload)).error,
      "string",
    );
  assert.equal(
    typeof (
      await dispatch("remote-settings-save", {
        provider: "openrouter",
        host: "https://evil.test",
      })
    ).error,
    "string",
  );
  assert.equal(requests, 0);
});

test("local status performs no remote network requests with remote consent enabled", async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    throw new Error("loopback unavailable");
  };
  const status = await dispatch("ollama-status", {
    host: "http://127.0.0.1:11434",
  });
  assert.equal(status.connected, false);
  assert.ok(requests.length > 0);
  assert.ok(requests.every((url) => new URL(url).hostname === "127.0.0.1"));
});
