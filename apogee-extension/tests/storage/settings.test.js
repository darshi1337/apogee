import test from "node:test";
import assert from "node:assert";

import { getSettings } from "../../lib/storage/settings.js";
import {
  DEFAULT_LLAMACPP_HOST,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_SETTINGS,
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
