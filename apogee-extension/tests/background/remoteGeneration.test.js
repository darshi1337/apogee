import test from "node:test";
import assert from "node:assert/strict";
import {
  createRemoteJobContext,
  generateRemote,
  validateRemoteGenerationPayload,
} from "../../background/remoteGeneration.js";
import { saveRemoteSettings } from "../../lib/storage/remoteSettings.js";
import {
  updateSettings,
  updateRemoteCredentialsSettings,
} from "../../lib/storage/settings.js";

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => {
      for (const listener of listeners) listener(...args);
    },
    get size() {
      return listeners.size;
    },
  };
}

const changes = event();
const removed = event();
let store;
const chrome = {
  storage: {
    onChanged: changes,
    local: {
      get: async (key) => ({ [key]: structuredClone(store[key]) }),
      set: async (values) => {
        const update = {};
        for (const [key, value] of Object.entries(values)) {
          update[key] = {
            oldValue: store[key],
            newValue: structuredClone(value),
          };
          store[key] = structuredClone(value);
        }
        changes.emit(update, "local");
      },
      remove: async (key) => {
        delete store[key];
      },
    },
  },
  permissions: { contains: async () => true, onRemoved: removed },
};

function install(overrides = {}) {
  globalThis.chrome = chrome;
  chrome.permissions.contains = async () => true;
  delete chrome.i18n;
  store = {
    settings: {
      provider: "openrouter",
      autoEngine: false,
      openrouterConsent: true,
      openrouterGenerationConsent: true,
      openrouterGenerationRevision: 3,
      openrouterApiKey: "router-secret",
      openrouterModel: "test/free",
      summaryLanguage: "auto",
      translationEngine: "llm",
      customInstructions: "Use short sentences",
      responseFormat: "bullets",
      ...overrides,
    },
    "remoteCatalog:openrouter": {
      models: [
        { id: "test/free", label: "Test", contextTokens: 8192 },
        { id: "test/other", label: "Other", contextTokens: 8192 },
      ],
      refreshedAt: Date.now(),
      failed: false,
    },
  };
  return store;
}

const payload = (action = "ask") => ({
  action,
  title: "Page",
  url: "https://example.com/page",
  content: "private page text",
  ...(action === "ask"
    ? { question: "What happened?" }
    : { type: "article", mode: "bullets" }),
});
const consume = async (stream) => {
  let text = "";
  for await (const token of stream) text += token;
  return text;
};
const freeModel = () => ({
  id: "test/free",
  name: "Test",
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  context_length: 8192,
});
function mockGeneration() {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/models")
      ? Response.json({ data: [freeModel()] })
      : new Response(
          'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n',
        );
  };
  return calls;
}

test("remote contexts pin nonsecret execution settings and never fetch during readiness", async (t) => {
  install();
  globalThis.fetch = async () =>
    assert.fail("context setup must use local catalog state");
  const context = await createRemoteJobContext();
  t.after(context.dispose);
  assert.equal(context.provider, "openrouter");
  assert.equal(context.model, "test/free");
  assert.ok(Object.isFrozen(context.settings));
  assert.ok(!JSON.stringify(context.settings).includes("router-secret"));
  assert.ok(
    !Object.keys(context.settings).some((key) => key.endsWith("ApiKey")),
  );
  await updateSettings({ theme: "light", customInstructions: "Changed later" });
  await context.assertActive();
  assert.equal(context.settings.customInstructions, "Use short sentences");
  assert.equal(context.settings.openrouterGenerationRevision, 3);
});

test("context admission rejects implicit routing, missing generation consent and stale catalogs", async () => {
  for (const overrides of [
    { provider: "local" },
    { autoEngine: true },
    { openrouterGenerationConsent: false },
    { openrouterConsent: false },
    { openrouterApiKey: "" },
    { openrouterModel: "test/missing" },
  ]) {
    install(overrides);
    await assert.rejects(
      createRemoteJobContext(),
      (error) => error.isUserFacing,
    );
  }
  install();
  store["remoteCatalog:openrouter"].refreshedAt = Date.now() - 3600001;
  await assert.rejects(createRemoteJobContext(), /refresh the catalog/);
});

test("revoking and reconsenting with the same key cannot revive an admitted job", async (t) => {
  install();
  const context = await createRemoteJobContext();
  t.after(context.dispose);
  await saveRemoteSettings({
    provider: "openrouter",
    generationConsent: false,
  });
  await saveRemoteSettings({ provider: "openrouter", generationConsent: true });
  assert.equal(store.settings.openrouterApiKey, "router-secret");
  assert.ok(
    store.settings.openrouterGenerationRevision >
      context.settings.openrouterGenerationRevision,
  );
  assert.equal(context.signal.aborted, true);
  await assert.rejects(context.assertActive(), /authorization changed/);
  const replacement = await createRemoteJobContext();
  t.after(replacement.dispose);
  await replacement.assertActive();
});

test("provider, model and key changes invalidate pinned contexts", async (t) => {
  for (const change of [
    () => updateSettings({ provider: "opencode" }),
    () => updateRemoteCredentialsSettings({ openrouterModel: "test/other" }),
    () =>
      updateRemoteCredentialsSettings({
        openrouterApiKey: "replacement-secret",
      }),
  ]) {
    install();
    const context = await createRemoteJobContext();
    t.after(context.dispose);
    await change();
    assert.equal(context.signal.aborted, true);
    await assert.rejects(context.assertActive(), /authorization changed/);
    context.dispose();
  }
});

test("Firefox admission and ongoing checks require generation permissions", async (t) => {
  const previous = process.env.TARGET_BROWSER;
  process.env.TARGET_BROWSER = "firefox";
  t.after(() => {
    if (previous === undefined) delete process.env.TARGET_BROWSER;
    else process.env.TARGET_BROWSER = previous;
  });
  install();
  chrome.permissions.contains = async () => false;
  await assert.rejects(createRemoteJobContext(), /authorization changed/);
  chrome.permissions.contains = async () => true;
  const context = await createRemoteJobContext();
  t.after(context.dispose);
  chrome.permissions.contains = async () => false;
  await assert.rejects(context.assertActive(), /authorization changed/);
  assert.equal(context.signal.aborted, true);
});

test("permission removal and caller cancellation abort contexts and disposal removes listeners", async () => {
  install();
  const controller = new AbortController();
  const before = removed.size;
  const context = await createRemoteJobContext({ signal: controller.signal });
  assert.equal(removed.size, before + 1);
  removed.emit({ data_collection: ["websiteContent"] });
  await assert.rejects(context.assertActive(), /authorization changed/);
  context.dispose();
  assert.equal(removed.size, before);
  const cancelled = await createRemoteJobContext({ signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled.assertActive(), /authorization changed/);
  cancelled.dispose();
  assert.equal(removed.size, before);
});

test("Summary and Ask generate with the saved provider model and local retrieval", async (t) => {
  for (const action of ["summarize", "ask"]) {
    install();
    const context = await createRemoteJobContext();
    t.after(context.dispose);
    const calls = mockGeneration();
    const retrievals = [];
    const answer = await consume(
      generateRemote(context, payload(action), {
        getRelevantContent: async (...args) => {
          retrievals.push(args);
          return "locally retrieved evidence";
        },
      }),
    );
    assert.equal(answer, "answer");
    const posts = calls.filter((call) => call.options.method === "POST");
    assert.equal(posts.length, 1);
    const body = JSON.parse(posts[0].options.body);
    assert.equal(body.model, "test/free");
    assert.ok(posts[0].url.startsWith("https://openrouter.ai/"));
    assert.ok(!posts[0].options.body.includes("router-secret"));
    assert.ok(posts[0].options.body.includes("Use short sentences"));
    if (action === "ask") {
      assert.deepEqual(retrievals, [["private page text", "What happened?"]]);
      assert.ok(posts[0].options.body.includes("locally retrieved evidence"));
    } else assert.deepEqual(retrievals, []);
    context.dispose();
  }
});

test("cancellation during local retrieval finishes without waiting or sending a POST", async (t) => {
  install();
  const controller = new AbortController();
  const context = await createRemoteJobContext({ signal: controller.signal });
  t.after(context.dispose);
  const calls = mockGeneration();
  const { promise: started, resolve: start } = Promise.withResolvers();
  const { promise: retrieval, resolve: finish } = Promise.withResolvers();
  const request = consume(
    generateRemote(context, payload(), {
      getRelevantContent: () => {
        start();
        return retrieval;
      },
    }),
  );
  const rejected = assert.rejects(request, /authorization changed/);
  await started;
  controller.abort();
  await rejected;
  finish("late private result");
  await Promise.resolve();
  assert.deepEqual(calls, []);
});

test("revocation while local retrieval is pending discards its late output", async (t) => {
  install();
  const context = await createRemoteJobContext();
  t.after(context.dispose);
  const calls = mockGeneration();
  const { promise: started, resolve: start } = Promise.withResolvers();
  const { promise: retrieval, resolve: finish } = Promise.withResolvers();
  const request = consume(
    generateRemote(context, payload(), {
      getRelevantContent: () => {
        start();
        return retrieval;
      },
    }),
  );
  const rejected = assert.rejects(request, /authorization changed/);
  await started;
  await saveRemoteSettings({
    provider: "openrouter",
    generationConsent: false,
  });
  await rejected;
  finish("late private result");
  await Promise.resolve();
  assert.deepEqual(calls, []);
});

test("remote payload validation rejects configuration overrides at either boundary", () => {
  for (const field of [
    "provider",
    "providerType",
    "model",
    "host",
    "apiKey",
    "consent",
    "language",
    "translationEngine",
  ]) {
    assert.throws(
      () =>
        validateRemoteGenerationPayload({ ...payload(), [field]: "untrusted" }),
      /Invalid remote generation/,
    );
    assert.throws(
      () =>
        validateRemoteGenerationPayload({
          ...payload(),
          finalize: { [field]: "untrusted" },
        }),
      /Invalid remote generation/,
    );
  }
  assert.deepEqual(validateRemoteGenerationPayload(payload()), payload());
  for (const invalid of [
    { ...payload(), action: "suggest" },
    { ...payload(), question: " " },
    { ...payload(), content: " " },
  ])
    assert.throws(
      () => validateRemoteGenerationPayload(invalid),
      /Invalid remote generation/,
    );
});

test("B2 purposes require independent grants and pin parent execution", async () => {
  for (const purpose of ["background", "multi-tab", "suggestions"]) {
    install();
    await assert.rejects(
      createRemoteJobContext({ purpose }),
      /authorization changed/,
    );
    const field =
      purpose === "suggestions"
        ? "openrouterSuggestionsConsent"
        : "openrouterBackgroundConsent";
    install({ [field]: true });
    const context = await createRemoteJobContext({
      purpose,
      expected: { provider: "openrouter", model: "test/free", revision: 3 },
    });
    assert.equal(context.revision, 3);
    removed.emit({ data_collection: ["websiteContent"] });
    assert.equal(context.signal.aborted, true);
    await assert.rejects(context.assertActive());
    context.dispose();
    install({ [field]: true });
    await assert.rejects(
      createRemoteJobContext({
        purpose,
        expected: { provider: "openrouter", model: "old/model", revision: 3 },
      }),
    );
  }
});
