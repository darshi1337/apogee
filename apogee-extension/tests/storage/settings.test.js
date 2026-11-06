import test from "node:test";
import {
  getRemoteSettings,
  saveRemoteSettings,
} from "../../lib/storage/remoteSettings.js";
import assert from "node:assert";

import {
  getSettings,
  getRemoteCredentialsSettings,
  updateSettings,
  updateRemoteCredentialsSettings,
} from "../../lib/storage/settings.js";
import {
  DEFAULT_LLAMACPP_HOST,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_SETTINGS,
  WEBLLM_MODELS,
  isKnownWebLLMModelId,
} from "../../lib/constants.js";

function installFakeStorage(settings) {
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ settings }),
      },
    },
  };
}

test("getSettings returns defaults when nothing is stored", async () => {
  installFakeStorage(undefined);
  const settings = await getSettings();
  assert.equal(settings.provider, DEFAULT_SETTINGS.provider);
  assert.equal(settings.ollamaHost, DEFAULT_OLLAMA_HOST);
  assert.equal(settings.llamaHost, DEFAULT_LLAMACPP_HOST);
});

test("getSettings preserves valid providers and loopback hosts", async () => {
  installFakeStorage({
    provider: "local",
    ollamaHost: "http://127.0.0.1:11434",
    llamaHost: "http://localhost:8080",
  });
  const settings = await getSettings();
  assert.equal(settings.provider, "local");
  assert.equal(settings.ollamaHost, "http://127.0.0.1:11434");
  assert.equal(settings.llamaHost, "http://localhost:8080");
});

test("isKnownWebLLMModelId allow-lists only bundled models", () => {
  for (const m of WEBLLM_MODELS) {
    assert.equal(isKnownWebLLMModelId(m.id), true);
  }
  assert.equal(isKnownWebLLMModelId("Qwen2.5-7B-Instruct-q4f16_1-MLC"), false);
  assert.equal(isKnownWebLLMModelId(""), false);
  assert.equal(isKnownWebLLMModelId(null), false);
  assert.equal(isKnownWebLLMModelId(undefined), false);
});

test("getSettings resets an unknown WebLLM model to the default", async () => {
  installFakeStorage({ webllmModel: "Evil-9B-q4f16_1-MLC" });
  const settings = await getSettings();
  assert.equal(settings.webllmModel, DEFAULT_SETTINGS.webllmModel);
  assert.equal(isKnownWebLLMModelId(settings.webllmModel), true);
});

test("getSettings preserves a known WebLLM model", async () => {
  installFakeStorage({ webllmModel: WEBLLM_MODELS[1].id });
  const settings = await getSettings();
  assert.equal(settings.webllmModel, WEBLLM_MODELS[1].id);
});

test("getSettings falls back on unknown provider and non-loopback hosts", async () => {
  installFakeStorage({
    provider: "evil-cloud",
    ollamaHost: "http://example.com:11434",
    llamaHost: "https://127.0.0.1:8080",
  });
  const settings = await getSettings();
  assert.equal(settings.provider, DEFAULT_SETTINGS.provider);
  assert.equal(settings.ollamaHost, DEFAULT_OLLAMA_HOST);
  assert.equal(settings.llamaHost, DEFAULT_LLAMACPP_HOST);
});

test("getSettings preserves IPv6 loopback and normalizes loopback variants", async () => {
  installFakeStorage({
    ollamaHost: "http://[::1]:11434/",
    llamaHost: "http://localhost",
  });
  const settings = await getSettings();
  assert.equal(settings.ollamaHost, "http://[::1]:11434");
  assert.equal(settings.llamaHost, "http://localhost:8080");
});

function writableStorage(initial = {}) {
  const store = { settings: structuredClone(initial) };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => structuredClone(store),
        set: async (values) => Object.assign(store, structuredClone(values)),
        remove: async (key) => {
          delete store[key];
        },
      },
    },
  };
  return store;
}

test("legacy catalog consent never enables generation and ordinary settings redact remote keys", async () => {
  writableStorage({
    openrouterConsent: true,
    openrouterApiKey: "secret",
    opencodeApiKey: "other",
  });
  const settings = await getSettings();
  assert.equal(settings.openrouterHasApiKey, true);
  assert.equal(settings.opencodeHasApiKey, true);
  assert.equal(settings.openrouterGenerationConsent, false);
  assert.equal(settings.openrouterGenerationRevision, 0);
  assert.equal(Object.hasOwn(settings, "openrouterApiKey"), false);
  assert.equal(Object.hasOwn(settings, "opencodeApiKey"), false);
  assert.equal(
    (await getRemoteCredentialsSettings()).openrouterApiKey,
    "secret",
  );
});

test("ordinary writes preserve credentials and cannot opt into remote generation", async () => {
  const store = writableStorage({
    openrouterApiKey: "secret",
    openrouterGenerationRevision: 3,
  });
  const settings = await updateSettings((current) => {
    assert.equal(Object.hasOwn(current, "openrouterApiKey"), false);
    return {
      theme: "light",
      openrouterApiKey: "replacement",
      openrouterHasApiKey: false,
      openrouterGenerationConsent: true,
    };
  });
  assert.equal(settings.theme, "light");
  assert.equal(settings.openrouterHasApiKey, true);
  assert.equal(Object.hasOwn(store.settings, "openrouterHasApiKey"), false);
  assert.equal(Object.hasOwn(settings, "openrouterApiKey"), false);
  assert.equal(store.settings.openrouterApiKey, "secret");
  assert.equal(store.settings.openrouterGenerationConsent, false);
  assert.equal(store.settings.openrouterGenerationRevision, 3);
});

test("generation revisions persist and advance on consent, key and model changes only", async () => {
  writableStorage();
  for (const [patch, expected] of [
    [{ openrouterConsent: true }, 0],
    [{ openrouterGenerationConsent: true }, 1],
    [{ openrouterApiKey: "key" }, 2],
    [{ openrouterModel: "model-a" }, 3],
    [{ openrouterGenerationConsent: false }, 4],
    [{ openrouterGenerationConsent: true }, 5],
    [{ openrouterGenerationConsent: true }, 5],
    [{ openrouterGenerationRevision: 0 }, 5],
  ]) {
    await updateRemoteCredentialsSettings(patch);
    assert.equal(
      (await getRemoteCredentialsSettings()).openrouterGenerationRevision,
      expected,
    );
  }
  await updateSettings({ theme: "light" });
  assert.equal(
    (await getRemoteCredentialsSettings()).openrouterGenerationRevision,
    5,
  );
});

test("remote views omit saved keys and Revoke clears both consents with a persisted revision", async () => {
  const store = writableStorage({
    openrouterConsent: true,
    openrouterGenerationConsent: true,
    openrouterGenerationRevision: 8,
    openrouterApiKey: "secret",
  });
  const before = await getRemoteSettings();
  assert.equal(before.providers.openrouter.hasApiKey, true);
  assert.equal(before.providers.openrouter.generationConsent, true);
  assert.equal(JSON.stringify(before).includes("secret"), false);
  const after = await saveRemoteSettings({
    provider: "openrouter",
    consent: false,
  });
  assert.equal(after.providers.openrouter.consent, false);
  assert.equal(after.providers.openrouter.generationConsent, false);
  assert.equal(after.providers.openrouter.generationRevision, 9);
  assert.equal(store.settings.openrouterApiKey, "secret");
  await assert.rejects(
    saveRemoteSettings({ provider: "openrouter", generationConsent: "true" }),
    /Invalid generation consent/,
  );
});
