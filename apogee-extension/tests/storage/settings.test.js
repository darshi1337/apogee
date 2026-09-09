import test from "node:test";
import assert from "node:assert";

import { getSettings } from "../../lib/storage/settings.js";
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
