import test from "node:test";
import assert from "node:assert";

import {
  getProvider,
  getProviderType,
  getModelForSettings,
  getProviderForType,
  resolveEngineChain,
  runWithEngineFallback,
  buildExtractedTextFallback,
  StreamCancelledError,
} from "../../lib/engines/providers.js";
import {
  PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_SETTINGS,
  DEFAULT_LLAMACPP_HOST,
} from "../../lib/constants.js";

const settings = (overrides) => ({ ...DEFAULT_SETTINGS, ...overrides });

test("every local provider resolves to its own implementation and remotes use the remote adapter", () => {
  const seen = new Map();
  for (const type of Object.values(PROVIDERS)) {
    const provider = getProvider(settings({ provider: type }));
    if ([PROVIDERS.OPENROUTER, PROVIDERS.OPENCODE].includes(type)) {
      assert.equal(provider.constructor.name, "RemoteProvider");
      assert.equal(provider.provider, type);
      continue;
    }
    seen.set(type, provider.constructor.name);
  }
  // Each provider must get its own class; two mapping to the same one would mean a missing branch in getProvider silently falling through.
  assert.equal(
    new Set(seen.values()).size,
    seen.size,
    `providers collapsed onto the same class: ${JSON.stringify([...seen])}`,
  );
  assert.equal(seen.get(PROVIDERS.LLAMACPP), "DirectLlamaCppProvider");
});

test("remote models and adapters carry only nonsecret identity", () => {
  for (const provider of [PROVIDERS.OPENROUTER, PROVIDERS.OPENCODE]) {
    const configured = settings({
      provider,
      [`${provider}Model`]: "chosen/model",
      [`${provider}ApiKey`]: "secret",
    });
    assert.equal(getModelForSettings(configured), "chosen/model");
    assert.deepStrictEqual(Object.keys(getProvider(configured)).sort(), [
      "model",
      "provider",
    ]);
  }
});

test("remote adapters send only generation inputs and query redacted readiness", async () => {
  const messages = [];
  let status = {
    consent: true,
    generationConsent: true,
    hasApiKey: true,
    model: "chosen/model",
    catalog: { stale: false, models: [{ id: "chosen/model" }] },
  };
  globalThis.chrome = {
    runtime: {
      sendMessage: (message, callback) => {
        messages.push(message);
        callback(
          message.action === "remote-settings-get"
            ? { providers: { openrouter: status } }
            : { streamId: "remote-id" },
        );
      },
    },
  };
  try {
    const provider = getProvider(
      settings({
        provider: PROVIDERS.OPENROUTER,
        openrouterModel: "chosen/model",
        openrouterApiKey: "secret",
      }),
    );
    assert.deepStrictEqual(await provider.checkReady(), { ready: true });
    for (const patch of [
      { consent: false },
      { generationConsent: false },
      { hasApiKey: false },
      { catalog: { stale: true, models: [{ id: "chosen/model" }] } },
      { model: "absent" },
    ]) {
      const before = status;
      status = { ...status, ...patch };
      assert.deepStrictEqual(await provider.checkReady(), { ready: false });
      status = before;
    }
    await provider.summarize({
      title: "title",
      url: "https://example.com",
      content: "text",
      mode: "brief",
      type: "article",
      language: "fr",
      translationEngine: "remote",
      provider: "opencode",
      model: "untrusted",
      host: "https://evil.example",
      apiKey: "secret",
      consent: true,
      finalize: {
        jobId: "job",
        tabId: 1,
        pageType: "article",
        apiKey: "secret",
        cacheKey: "forged",
        providerType: "opencode",
        model: "forged",
        host: "https://evil.example",
        language: "fr",
        translationEngine: "remote",
      },
    });
    await provider.ask({
      title: "title",
      url: "https://example.com",
      content: "text",
      question: "why?",
      language: "fr",
      model: "untrusted",
      apiKey: "secret",
    });
    for (const message of messages.filter(
      (entry) => entry.action === "remote-stream",
    )) {
      for (const key of [
        "provider",
        "model",
        "host",
        "apiKey",
        "consent",
        "language",
        "translationEngine",
      ]) {
        assert.ok(!Object.hasOwn(message.payload, key), key);
      }
    }
    assert.deepStrictEqual(
      messages
        .filter((entry) => entry.action === "remote-stream")
        .map((entry) => entry.payload.action),
      ["summarize", "ask"],
    );
    assert.deepStrictEqual(
      messages.find((entry) => entry.payload?.action === "summarize").payload
        .finalize,
      { jobId: "job", tabId: 1, pageType: "article" },
    );
    assert.ok(
      messages.every((entry) =>
        ["remote-settings-get", "remote-stream"].includes(entry.action),
      ),
    );
  } finally {
    delete globalThis.chrome;
  }
});

test("automatic and fallback chains exclude remote engines even when supplied", () => {
  for (const provider of [
    PROVIDERS.LOCAL,
    PROVIDERS.OPENROUTER,
    PROVIDERS.OPENCODE,
  ]) {
    for (const chain of [
      undefined,
      [PROVIDERS.OPENROUTER, PROVIDERS.LOCAL, PROVIDERS.OPENCODE],
    ]) {
      assert.ok(
        resolveEngineChain(settings({ provider }), chain).every(
          (type) => ![PROVIDERS.OPENROUTER, PROVIDERS.OPENCODE].includes(type),
        ),
      );
    }
  }
});

test("an explicit remote attempt never retries or exposes raw failure text", async () => {
  for (const provider of [PROVIDERS.OPENROUTER, PROVIDERS.OPENCODE]) {
    const tried = [];
    await assert.rejects(
      runWithEngineFallback(
        settings({ provider, autoEngine: false }),
        [PROVIDERS.LOCAL],
        async (type) => {
          tried.push(type);
          throw new Error("secret provider response");
        },
        { content: "private extracted text" },
      ),
      (error) => error.isUserFacing && !error.message.includes("secret"),
    );
    assert.deepStrictEqual(tried, [provider]);
    await assert.rejects(
      runWithEngineFallback(
        settings({ provider, autoEngine: true }),
        undefined,
        async () => assert.fail("must not start"),
      ),
      /local engine/,
    );
  }
});

test("getProviderType passes a known provider through and rejects anything else", () => {
  assert.equal(
    getProviderType(settings({ provider: PROVIDERS.LLAMACPP })),
    PROVIDERS.LLAMACPP,
  );
  assert.equal(
    getProviderType(settings({ provider: "nonsense" })),
    DEFAULT_PROVIDER,
  );
  assert.equal(
    getProviderType(settings({ provider: undefined })),
    DEFAULT_PROVIDER,
  );
});

// Each provider reads its model from its own settings key. Reading the wrong one would send an empty or foreign model name to the server, and would also poison the summary cache key, which is built from this value.
test("getModelForSettings reads each provider's own model key", () => {
  const configured = settings({
    webllmModel: "webllm-one",
    transformersModel: "transformers-one",
    localModel: "ollama-one",
    llamaModel: "llamacpp-one",
  });
  assert.equal(
    getModelForSettings({ ...configured, provider: PROVIDERS.LLAMACPP }),
    "llamacpp-one",
  );
  assert.equal(
    getModelForSettings({ ...configured, provider: PROVIDERS.LOCAL }),
    "ollama-one",
  );
  assert.equal(
    getModelForSettings({ ...configured, provider: PROVIDERS.TRANSFORMERS }),
    "transformers-one",
  );
});

test("the llama.cpp provider carries the configured host, model and key", () => {
  const provider = getProvider(
    settings({
      provider: PROVIDERS.LLAMACPP,
      llamaHost: "http://localhost:9999",
      llamaModel: "some-model.gguf",
      llamaApiKey: "test-api-key",
    }),
  );
  assert.equal(provider.host, "http://localhost:9999");
  assert.equal(provider.model, "some-model.gguf");
  assert.equal(provider.apiKey, "test-api-key");
});

test("the llama.cpp provider falls back to the default host and an absent key", () => {
  const provider = getProvider(
    settings({
      provider: PROVIDERS.LLAMACPP,
      llamaHost: "",
      llamaApiKey: undefined,
    }),
  );
  assert.equal(provider.host, DEFAULT_LLAMACPP_HOST);
  assert.equal(provider.apiKey, "");
});

// A trailing slash would produce "http://host//v1/chat/completions".
test("the llama.cpp provider strips trailing slashes from the host", () => {
  const provider = getProvider(
    settings({
      provider: PROVIDERS.LLAMACPP,
      llamaHost: "http://127.0.0.1:8080///",
    }),
  );
  assert.equal(provider.host, "http://127.0.0.1:8080");
});

test("llama.cpp settings defaults are present and inert", () => {
  assert.equal(DEFAULT_SETTINGS.llamaHost, DEFAULT_LLAMACPP_HOST);
  // Empty until the server is asked what it is serving.
  assert.equal(DEFAULT_SETTINGS.llamaModel, "");
  assert.equal(DEFAULT_SETTINGS.llamaApiKey, "");
  // Adding a provider must not change which one users get by default.
  assert.notEqual(DEFAULT_PROVIDER, PROVIDERS.LLAMACPP);
});

test("adding llama.cpp left the Ollama provider untouched", () => {
  const provider = getProvider(
    settings({
      provider: PROVIDERS.LOCAL,
      localModel: "qwen3:8b",
      ollamaHost: "http://127.0.0.1:11434",
    }),
  );
  assert.equal(provider.constructor.name, "DirectOllamaProvider");
  assert.equal(provider.host, "http://127.0.0.1:11434");
  assert.equal(provider.model, "qwen3:8b");
});

// Provider fallback chain across engines (#415): the preferred engine runs
// first, entries with missing keys are skipped, and extracted text is the
// last resort when no engine answers.
test("resolveEngineChain prefers the configured engine and skips missing keys", () => {
  const chain = resolveEngineChain(
    settings({ provider: PROVIDERS.LOCAL, llamaApiKey: "" }),
  );
  assert.equal(chain[0], PROVIDERS.LOCAL);
  assert.ok(!chain.includes(PROVIDERS.LLAMACPP));
  const withKey = resolveEngineChain(
    settings({ provider: PROVIDERS.LOCAL, llamaApiKey: "k" }),
  );
  assert.ok(withKey.includes(PROVIDERS.LLAMACPP));
});

test("resolveEngineChain never skips the explicitly preferred engine", () => {
  const chain = resolveEngineChain(
    settings({ provider: PROVIDERS.LLAMACPP, llamaApiKey: "" }),
  );
  assert.equal(chain[0], PROVIDERS.LLAMACPP);
});

test("resolveEngineChain honors an explicit order and drops unknowns", () => {
  const chain = resolveEngineChain(
    settings({ provider: PROVIDERS.LOCAL, llamaApiKey: "k" }),
    [PROVIDERS.LLAMACPP, "nonsense", PROVIDERS.LOCAL, PROVIDERS.LOCAL],
  );
  assert.deepStrictEqual(chain, [PROVIDERS.LLAMACPP, PROVIDERS.LOCAL]);
});

test("runWithEngineFallback tries the next engine after a failure", async () => {
  const tried = [];
  const out = await runWithEngineFallback(
    settings({ provider: PROVIDERS.LOCAL }),
    [PROVIDERS.LOCAL, PROVIDERS.TRANSFORMERS],
    async (type, provider) => {
      tried.push(type);
      assert.ok(provider);
      if (type === PROVIDERS.LOCAL) throw new Error("boom");
      return "ok";
    },
    { content: "page text" },
  );
  assert.equal(out.type, PROVIDERS.TRANSFORMERS);
  assert.equal(out.result, "ok");
  assert.deepStrictEqual(tried, [PROVIDERS.LOCAL, PROVIDERS.TRANSFORMERS]);
  assert.equal(out.errors.length, 1);
});

test("runWithEngineFallback falls back to extracted text when all fail", async () => {
  const out = await runWithEngineFallback(
    settings({ provider: PROVIDERS.LOCAL, llamaApiKey: "" }),
    [PROVIDERS.LOCAL],
    async () => {
      throw new Error("down");
    },
    { content: "  page text here  " },
  );
  assert.equal(out.type, "extracted-text");
  assert.equal(out.result.fallbackText, "page text here");
});

test("runWithEngineFallback rethrows cancellation without trying more", async () => {
  const tried = [];
  await assert.rejects(
    runWithEngineFallback(
      settings({ provider: PROVIDERS.LOCAL }),
      [PROVIDERS.LOCAL, PROVIDERS.TRANSFORMERS],
      async (type) => {
        tried.push(type);
        throw new StreamCancelledError("Cancelled.");
      },
      {},
    ),
    StreamCancelledError,
  );
  assert.deepStrictEqual(tried, [PROVIDERS.LOCAL]);
});

test("buildExtractedTextFallback trims and caps long text", () => {
  assert.equal(buildExtractedTextFallback("  hi  "), "hi");
  assert.equal(buildExtractedTextFallback(""), "");
  assert.equal(buildExtractedTextFallback(null), "");
  assert.equal(buildExtractedTextFallback("abcdef", 3), "abc…");
});

test("getProviderForType builds a provider for an explicit chain entry", () => {
  const provider = getProviderForType(
    PROVIDERS.TRANSFORMERS,
    settings({ provider: PROVIDERS.LOCAL }),
  );
  assert.equal(provider.constructor.name, "TransformersProvider");
});
