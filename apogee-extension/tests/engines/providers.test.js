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

test("every provider in the registry resolves to its own implementation", () => {
  const seen = new Map();
  for (const type of Object.values(PROVIDERS)) {
    const provider = getProvider(settings({ provider: type }));
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
