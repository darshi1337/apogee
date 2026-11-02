import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRemoteModels } from "../../lib/engines/remoteModels.js";
import {
  fetchRemoteModels,
  streamRemoteChat,
  REMOTE_RESPONSE_MAX_BYTES,
} from "../../lib/engines/remoteClient.js";
import {
  getRemoteSettings,
  saveRemoteSettings,
  refreshRemoteModels,
} from "../../lib/storage/remoteSettings.js";
import { getRedactedSettings } from "../../lib/util/diagnostics.js";
import { getSettings, updateSettings } from "../../lib/storage/settings.js";

const freeModel = (id = "test/free") => ({
  id,
  name: "Test",
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  endpoints: ["/api/v1/chat/completions"],
  context_length: 8192,
});
const paidModel = (id = "test/paid") => ({
  id,
  type: "chat",
  modalities: { input: ["text"], output: ["text"] },
  api: {
    "chat-completions": { base_url: "https://opencode.ai/inference/openai/v1" },
  },
  cost: { text: { input: { price: 1 }, output: { price: 2 } } },
  limit: { context: 32768 },
});

function install(settings = {}) {
  const store = { settings: structuredClone(settings) };
  const listeners = [];
  globalThis.chrome = {
    storage: {
      onChanged: { addListener: (listener) => listeners.push(listener) },
      local: {
        get: async (key) => ({ [key]: structuredClone(store[key]) }),
        set: async (values) => {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = {
              oldValue: store[key],
              newValue: structuredClone(value),
            };
            store[key] = structuredClone(value);
          }
          for (const listener of listeners) listener(changes, "local");
        },
        remove: async (key) => {
          delete store[key];
        },
      },
    },
    permissions: { contains: async () => true },
  };
  return store;
}
const authorized = () => ({
  openrouterConsent: true,
  openrouterApiKey: "router-secret",
  openrouterModel: "test/free",
  opencodeConsent: true,
  opencodeApiKey: "code-secret",
});
const catalog = () => Response.json({ data: [freeModel()] });

test("remote model normalization enforces free OpenRouter and paid compatible OpenCode catalogs", () => {
  const router = normalizeRemoteModels("openrouter", {
    data: [
      freeModel(),
      { ...freeModel("paid"), pricing: { prompt: "0", completion: "0.1" } },
      { ...freeModel("missing"), pricing: {} },
      {
        ...freeModel("fee"),
        pricing: { prompt: "0", completion: "0", request: "1" },
      },
      { ...freeModel("not-chat"), endpoints: ["/api/v1/responses"] },
      {
        ...freeModel("legacy-not-chat"),
        endpoints: undefined,
        supported_endpoints: ["responses"],
      },
    ],
  });
  assert.deepEqual(router, [
    { id: "test/free", label: "Test", contextTokens: 8192 },
  ]);
  const paid = paidModel();
  assert.equal(
    normalizeRemoteModels("opencode", { data: [paid] })[0].contextTokens,
    32768,
  );
  for (const invalid of [
    { ...paid, type: "image" },
    { ...paid, api: { "chat-completions": { base_url: "https://evil.test" } } },
    { ...paid, cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
    { ...paid, modalities: { input: ["image"], output: ["text"] } },
  ])
    assert.deepEqual(
      normalizeRemoteModels("opencode", { data: [invalid] }),
      [],
    );
});

test("remote requests fail closed for missing, corrupt or revoked consent/key", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return catalog();
  };
  for (const settings of [
    {},
    { openrouterConsent: "true", openrouterApiKey: "key" },
    { openrouterConsent: true, openrouterApiKey: "key\nleak" },
    { openrouterConsent: false, openrouterApiKey: "key" },
  ]) {
    install(settings);
    await assert.rejects(fetchRemoteModels("openrouter"));
  }
  assert.equal(calls, 0);
});

test("fixed catalog origins isolate bearer keys and disable redirects, cookies and referrers", async () => {
  install(authorized());
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({
      data: url.includes("openrouter") ? [freeModel()] : [paidModel()],
    });
  };
  await fetchRemoteModels("openrouter");
  await fetchRemoteModels("opencode");
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/models");
  assert.equal(calls[1].url, "https://opencode.ai/inference/v1/models");
  assert.equal(calls[0].options.headers.Authorization, "Bearer router-secret");
  assert.equal(calls[1].options.headers.Authorization, "Bearer code-secret");
  for (const { options } of calls) {
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
  }
  await assert.rejects(fetchRemoteModels("https://evil.test"));
});

test("HTTP and stream failures expose safe errors and bound responses", async () => {
  install(authorized());
  for (const status of [401, 402, 403, 429, 500]) {
    globalThis.fetch = async () =>
      new Response("router-secret private transport failure", { status });
    await assert.rejects(
      fetchRemoteModels("openrouter"),
      (error) =>
        !error.message.includes("router-secret") &&
        !error.message.includes("private transport"),
    );
  }
  globalThis.fetch = async () =>
    new Response("{}", {
      headers: { "content-length": String(REMOTE_RESPONSE_MAX_BYTES + 1) },
    });
  await assert.rejects(fetchRemoteModels("openrouter"));
  globalThis.fetch = async () => {
    throw new Error("router-secret");
  };
  await assert.rejects(
    fetchRemoteModels("openrouter"),
    (error) => !error.message.includes("router-secret"),
  );
});

test("catalog setup returns redacted state, persists lastgood data and marks failed refresh stale", async () => {
  const store = install(authorized());
  globalThis.fetch = async () => catalog();
  const refreshed = await refreshRemoteModels("openrouter");
  assert.equal(refreshed.providers.openrouter.catalog.stale, false);
  assert.equal(store["remoteCatalog:openrouter"].models[0].id, "test/free");
  assert.ok(!JSON.stringify(refreshed).includes("router-secret"));
  await saveRemoteSettings({ provider: "openrouter", model: "test/free" });
  globalThis.fetch = async () => {
    throw new Error("private remote error");
  };
  await assert.rejects(refreshRemoteModels("openrouter"));
  const stale = await getRemoteSettings();
  assert.equal(stale.providers.openrouter.catalog.stale, true);
  assert.equal(stale.providers.openrouter.catalog.models[0].id, "test/free");
  await assert.rejects(
    saveRemoteSettings({ provider: "openrouter", model: "test/free" }),
  );
  globalThis.fetch = async () => Response.json({ data: [] });
  await refreshRemoteModels("openrouter");
  assert.equal((await getRemoteSettings()).providers.openrouter.model, "");
});

test("settings revoke aborts in-flight catalogs and prevents cache repopulation", async () => {
  install(authorized());
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      started();
      signal.addEventListener("abort", () => reject(new Error("secret")), {
        once: true,
      });
    });
  const request = refreshRemoteModels("openrouter");
  await ready;
  await saveRemoteSettings({ provider: "openrouter", consent: false });
  await assert.rejects(request);
  const view = (await getRemoteSettings()).providers.openrouter;
  assert.equal(view.consent, false);
  assert.deepEqual(view.catalog.models, []);
});

test("external storage key changes abort requests too", async () => {
  install(authorized());
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      started();
      signal.addEventListener("abort", () => reject(new Error("secret")), {
        once: true,
      });
    });
  const request = fetchRemoteModels("openrouter");
  await ready;
  await chrome.storage.local.set({
    settings: { ...authorized(), openrouterApiKey: "replacement" },
  });
  await assert.rejects(request);
});

test("chat streams fragmented CRLF SSE, keeps zero-price routing, and stops on DONE", async () => {
  install(authorized());
  const encoder = new TextEncoder();
  let chat;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/models")) return catalog();
    chat = { url, options };
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const part of [
            ": heartbeat\r",
            "\n\r\n",
            'data: {"choices":[{"delta":{"content":"hello"}}]}\r',
            "\n\r\ndata: [DONE]",
          ])
            controller.enqueue(encoder.encode(part));
          controller.close();
        },
      }),
    );
  };
  const tokens = [];
  await streamRemoteChat("openrouter", "private prompt", {
    onToken: (token) => tokens.push(token),
  });
  assert.deepEqual(tokens, ["hello"]);
  assert.equal(chat.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(JSON.parse(chat.options.body).provider.max_price, {
    prompt: 0,
    completion: 0,
    request: 0,
  });
  assert.equal(chat.options.redirect, "error");
});

test("diagnostics redact both keys and serialized settings writes preserve unrelated fields", async () => {
  install(authorized());
  await Promise.all([
    updateSettings({ theme: "light" }),
    updateSettings({ openrouterConsent: false }),
  ]);
  const settings = await getSettings();
  assert.equal(settings.theme, "light");
  assert.equal(settings.openrouterConsent, false);
  const redacted = JSON.stringify(getRedactedSettings(settings));
  assert.ok(!redacted.includes("router-secret"));
  assert.ok(!redacted.includes("code-secret"));
});

test("concurrent refreshes share a catalog request and persisted metadata is revalidated", async () => {
  const store = install(authorized());
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return catalog();
  };
  await Promise.all([
    refreshRemoteModels("openrouter"),
    refreshRemoteModels("openrouter"),
  ]);
  assert.equal(calls, 1);
  store["remoteCatalog:openrouter"].models.push({
    id: "https://bad?secret=key",
    label: "bad",
  });
  assert.equal(
    (await getRemoteSettings()).providers.openrouter.catalog.models.length,
    1,
  );
  await assert.rejects(
    saveRemoteSettings({
      provider: "openrouter",
      apiKey: "replacement",
      host: "https://evil.test",
    }),
  );
  assert.equal(store.settings.openrouterApiKey, "router-secret");
});

test("bounded readers reject oversized data, malformed SSE, and interrupted streams", async () => {
  install(authorized());
  globalThis.fetch = async () =>
    new Response(new Uint8Array(REMOTE_RESPONSE_MAX_BYTES + 1));
  await assert.rejects(fetchRemoteModels("openrouter"));
  for (const text of [
    "data: {private transport error}\n\n",
    'data: {"error":{"message":"router-secret"}}\n\n',
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    "data: " + "x".repeat(65537),
  ]) {
    globalThis.fetch = async (url) =>
      url.endsWith("/models") ? catalog() : new Response(text);
    await assert.rejects(
      streamRemoteChat("openrouter", "private prompt"),
      (error) =>
        !error.message.includes("router-secret") &&
        !error.message.includes("private transport"),
    );
  }
});

test("revocation during cache commit removes the raced cache", async () => {
  const store = install(authorized());
  const originalSet = chrome.storage.local.set;
  chrome.storage.local.set = async (values) => {
    await originalSet(values);
    if (values["remoteCatalog:openrouter"] && store.settings.openrouterConsent)
      await originalSet({
        settings: { ...store.settings, openrouterConsent: false },
      });
  };
  globalThis.fetch = async () => catalog();
  await assert.rejects(refreshRemoteModels("openrouter"));
  assert.equal(store["remoteCatalog:openrouter"], undefined);
});

test("Firefox authentication consent is required before sending either preset key", async () => {
  install(authorized());
  const previous = process.env.TARGET_BROWSER;
  process.env.TARGET_BROWSER = "firefox";
  let requests = 0;
  const checked = [];
  chrome.permissions.contains = async (permission) => {
    checked.push(permission);
    return false;
  };
  globalThis.fetch = async () => {
    requests++;
    return catalog();
  };
  try {
    await assert.rejects(fetchRemoteModels("openrouter"));
    await assert.rejects(fetchRemoteModels("opencode"));
    assert.equal(requests, 0);
    assert.deepEqual(checked, [
      { data_collection: ["authenticationInfo"] },
      { data_collection: ["authenticationInfo"] },
    ]);
  } finally {
    if (previous === undefined) delete process.env.TARGET_BROWSER;
    else process.env.TARGET_BROWSER = previous;
  }
});

test("changed credentials between model validation and POST cannot send a stale selection", async () => {
  const store = install(authorized());
  const realGet = chrome.storage.local.get;
  let reads = 0;
  chrome.storage.local.get = async (key) => {
    if (key === "settings" && ++reads === 4)
      store.settings.openrouterApiKey = "changed-secret";
    return realGet(key);
  };
  let posts = 0;
  globalThis.fetch = async (url) => {
    if (!url.endsWith("/models")) posts++;
    return catalog();
  };
  await assert.rejects(streamRemoteChat("openrouter", "private prompt"));
  assert.equal(posts, 0);
});
