import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

const { chrome, getMessageListeners, getStorageData } =
  createExtensionApiMock();
const contextMenuListeners = [];
chrome.contextMenus = {
  removeAll(callback) {
    callback();
  },
  create() {},
  onClicked: {
    addListener(listener) {
      contextMenuListeners.push(listener);
    },
  },
};
const connectListeners = [];
chrome.runtime.onConnect = {
  addListener: (listener) => connectListeners.push(listener),
};
const alarmListeners = [];
chrome.alarms = {
  create() {},
  clear: async () => {},
  onAlarm: {
    addListener(listener) {
      alarmListeners.push(listener);
    },
  },
};
const removedPermissionListeners = new Set();
chrome.permissions.onRemoved = {
  addListener(listener) {
    removedPermissionListeners.add(listener);
  },
  removeListener(listener) {
    removedPermissionListeners.delete(listener);
  },
};
const broadcasts = [];
const sendMessage = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = async (message) => {
  broadcasts.push(message);
  return sendMessage(message);
};
globalThis.chrome = chrome;
const { runBackgroundSummarize, summarizeMultiTab } =
  await import("../../background/service-worker.js");
const { activeStreams, registeredStreamJobs, expireStreamForCleanup } =
  await import("../../background/streams.js");
const { saveViewState, loadViewState } =
  await import("../../lib/storage/viewState.js");
const { getSettings, updateSettings } =
  await import("../../lib/storage/settings.js");
const { saveRemoteSettings, getRemoteSettings } =
  await import("../../lib/storage/remoteSettings.js");
const { getSummaryAndPromptsCacheKeys } =
  await import("../../ui/promptsContext.js");
const router = getMessageListeners()[0];
const { takePendingFinalize, FINALIZE_FAILED_MESSAGE } =
  await import("../../background/finalize.js");
const sender = {
  id: chrome.runtime.id,
  url: chrome.runtime.getURL("ui/app.html"),
};
const dispatch = (action, payload) =>
  new Promise((resolve) => {
    assert.equal(
      router({ target: "service-worker", action, payload }, sender, resolve),
      true,
    );
  });
const url = "https://example.com/remote-worker";
const tabId = 443;
const jobId = "remote-worker-job";
const models = { openrouter: "test/free", opencode: "test/paid" };

async function waitFor(check, label) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function setup(provider = "openrouter", overrides = {}) {
  for (const id of activeStreams.keys()) expireStreamForCleanup(id);
  registeredStreamJobs.clear();
  await chrome.storage.local.clear();
  broadcasts.length = 0;
  await chrome.storage.local.set({
    settings: {
      provider,
      autoEngine: false,
      openrouterConsent: true,
      openrouterGenerationConsent: true,
      openrouterGenerationRevision: 0,
      openrouterApiKey: "router-secret",
      openrouterModel: models.openrouter,
      opencodeConsent: true,
      opencodeGenerationConsent: true,
      opencodeGenerationRevision: 0,
      opencodeApiKey: "code-secret",
      opencodeModel: models.opencode,
      summaryLanguage: "auto",
      translationEngine: "llm",
      responseFormat: "bullets",
      customInstructions: "Use short sentences",
      saveHistory: true,
      ...overrides,
    },
  });
  await getRemoteSettings();
  await chrome.storage.local.set(
    Object.fromEntries(
      Object.entries(models).map(([type, id]) => [
        `remoteCatalog:${type}`,
        {
          models: [{ id, label: "Selected", contextTokens: 8192 }],
          refreshedAt: Date.now(),
          failed: false,
        },
      ]),
    ),
  );
  await saveViewState(tabId, {
    view: "summaryView",
    subview: "summarizing",
    jobId,
    url,
  });
}

function catalog(provider) {
  return Response.json({
    data:
      provider === "openrouter"
        ? [
            {
              id: models.openrouter,
              name: "Free",
              pricing: { prompt: "0", completion: "0" },
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              context_length: 8192,
            },
          ]
        : [
            {
              id: models.opencode,
              name: "Paid",
              type: "chat",
              modalities: { input: ["text"], output: ["text"] },
              api: {
                "chat-completions": {
                  base_url: "https://opencode.ai/inference/openai/v1",
                },
              },
              cost: { text: { input: { price: 1 }, output: { price: 2 } } },
              limit: { context: 8192 },
            },
          ],
  });
}
const response = (text = "Remote answer") =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  );
function intercept(onRequest) {
  const calls = [];
  globalThis.fetch = async (address, options) => {
    const request = {
      url: address,
      options,
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(request);
    const result = await onRequest?.(request, calls);
    if (result) return result;
    return address.endsWith("/models")
      ? catalog(address.includes("openrouter") ? "openrouter" : "opencode")
      : response();
  };
  return calls;
}
function args(action = "summarize", overrides = {}) {
  return {
    action,
    title: "Worker page",
    url,
    content: "Private article body with enough information to summarize.",
    ...(action === "ask"
      ? { question: "What happened?" }
      : { type: "article", finalize: { tabId, jobId } }),
    ...overrides,
  };
}
async function run(payload = args()) {
  const result = await dispatch("remote-stream", payload);
  assert.ok(result.streamId, JSON.stringify(result));
  const stream = activeStreams.get(result.streamId);
  assert.ok(stream);
  await waitFor(
    () => stream.done && !registeredStreamJobs.has(result.streamId),
    "remote terminal state",
  );
  return { streamId: result.streamId, execution: result.execution, stream };
}
function assertNoSummarySaved() {
  const stored = getStorageData();
  assert.deepEqual(stored.cacheOrder || [], []);
  assert.ok(!Object.keys(stored).some((key) => key.startsWith("summary:")));
}
const longContent = () =>
  Array.from(
    { length: 80 },
    (_, index) =>
      `Section ${index}: ${"Evidence and facts about this event. ".repeat(22)}`,
  ).join("\n\n");

test("actual worker Summary uses both explicit providers and persists matching cache/view provenance", async () => {
  for (const provider of Object.keys(models)) {
    await setup(provider);
    const calls = intercept();
    const { stream, execution } = await run();
    assert.equal(execution.providerType, provider);
    assert.equal(execution.model, models[provider]);
    assert.ok(!JSON.stringify(execution).includes("secret"));
    assert.equal(stream.error, null);
    assert.equal(stream.text, "Remote answer");
    const posts = calls.filter((request) => request.body);
    assert.equal(posts.length, 1, "no automatic suggested-prompt generation");
    assert.equal(posts[0].body.model, models[provider]);
    assert.ok(
      posts[0].url.startsWith(
        provider === "openrouter"
          ? "https://openrouter.ai/"
          : "https://opencode.ai/",
      ),
    );
    const settings = await getSettings();
    const keys = await getSummaryAndPromptsCacheKeys(
      url,
      settings,
      models[provider],
      "",
      { pageType: "article" },
    );
    const stored = getStorageData();
    assert.equal(execution.cacheKey, keys.cacheKey);
    assert.equal(execution.promptsCacheKey, keys.promptsCacheKey);
    assert.equal(stored[keys.cacheKey], "Remote answer");
    assert.equal(stored.cacheOrder[0].s, keys.cacheKey);
    assert.equal(stored.cacheOrder[0].p, keys.promptsCacheKey);
    const state = await loadViewState(tabId);
    assert.equal(state.subview, "summary");
    assert.equal(state.summaryText, "Remote answer");
    assert.equal(state.providerType, provider);
    assert.equal(state.model, models[provider]);
    assert.equal(state.promptsCacheKey, keys.promptsCacheKey);
    assert.ok(
      !broadcasts.some((message) => message.type === "suggested-prompts-ready"),
    );
    const records = JSON.stringify(
      Object.fromEntries(
        Object.entries(stored).filter(([key]) => key !== "settings"),
      ),
    );
    assert.ok(!records.includes("router-secret"));
    assert.ok(!records.includes("code-secret"));
  }
});

test("actual worker Ask streams both saved provider models without summary persistence", async () => {
  for (const provider of Object.keys(models)) {
    await setup(provider);
    const calls = intercept();
    const { stream } = await run(args("ask"));
    assert.equal(stream.error, null);
    assert.equal(stream.text, "Remote answer");
    const posts = calls.filter((request) => request.body);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.model, models[provider]);
    assert.ok(
      posts[0].body.messages.some((message) =>
        message.content.includes("What happened?"),
      ),
    );
    assertNoSummarySaved();
  }
});

test("long Summary maps and reduces only through the pinned explicit remote model", async () => {
  await setup();
  const calls = intercept();
  const { stream } = await run(args("summarize", { content: longContent() }));
  assert.equal(stream.error, null);
  const posts = calls.filter((request) => request.body);
  assert.ok(posts.length >= 3, "multiple maps and a synthesis must run");
  assert.ok(
    posts.every(
      (request) =>
        request.body.model === models.openrouter &&
        request.url.startsWith("https://openrouter.ai/"),
    ),
  );
  assert.ok(
    posts.every((request) => request.body.provider.allow_fallbacks === false),
  );
  assert.equal((await loadViewState(tabId)).model, models.openrouter);
});

test("cancel during actual SSE streaming discards partial generation without persistence", async () => {
  await setup();
  intercept(({ url: address, options }) => {
    if (address.endsWith("/models")) return;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            ),
          );
          options.signal.addEventListener(
            "abort",
            () => controller.error(new Error("private transport detail")),
            { once: true },
          );
        },
      }),
    );
  });
  const { streamId } = await dispatch("remote-stream", args());
  const stream = activeStreams.get(streamId);
  await waitFor(() => stream.text === "partial", "first SSE token");
  assert.deepEqual(await dispatch("cancel-stream", { streamId }), { ok: true });
  await waitFor(() => !registeredStreamJobs.has(streamId), "cancel cleanup");
  assert.equal(stream.cancelled, true);
  assert.equal(stream.done, true);
  assertNoSummarySaved();
  assert.notEqual((await loadViewState(tabId))?.subview, "summary");
});

test("generation revoke between map calls prevents every later POST and successful persistence", async () => {
  await setup();
  let posts = 0;
  const calls = intercept(async ({ body }) => {
    if (body && ++posts === 1)
      await saveRemoteSettings({
        provider: "openrouter",
        generationConsent: false,
      });
  });
  const { stream } = await run(args("summarize", { content: longContent() }));
  assert.ok(stream.error);
  assert.equal(calls.filter((request) => request.body).length, 1);
  assertNoSummarySaved();
  assert.notEqual((await loadViewState(tabId))?.subview, "summary");
});

test("model or provider changes during generation cannot finalize under a different cache identity", async () => {
  for (const change of [
    () => saveRemoteSettings({ provider: "openrouter", model: "" }),
    () => updateSettings({ provider: "opencode" }),
  ]) {
    await setup();
    const calls = intercept(async ({ body }) => {
      if (body) await change();
    });
    const { stream } = await run();
    assert.ok(stream.error);
    assert.equal(calls.filter((request) => request.body).length, 1);
    assertNoSummarySaved();
    const state = await loadViewState(tabId);
    assert.notEqual(state?.subview, "summary");
    assert.equal(state?.providerType, "openrouter");
    assert.equal(state?.model, models.openrouter);
  }
});

test("generation revocation during actual SSE streaming stops completion and persistence", async () => {
  await setup();
  const calls = intercept(({ url: address, options }) => {
    if (address.endsWith("/models")) return;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            ),
          );
          options.signal.addEventListener(
            "abort",
            () => controller.error(new Error("router-secret private detail")),
            { once: true },
          );
        },
      }),
    );
  });
  const { streamId } = await dispatch("remote-stream", args());
  const stream = activeStreams.get(streamId);
  await waitFor(
    () => stream.text === "partial",
    "partial response before revocation",
  );
  await saveRemoteSettings({
    provider: "openrouter",
    generationConsent: false,
  });
  await waitFor(
    () => stream.done && !registeredStreamJobs.has(streamId),
    "revocation cleanup",
  );
  assert.ok(stream.error);
  assert.ok(!stream.error.includes("router-secret"));
  assert.ok(!stream.error.includes("private detail"));
  assert.equal(calls.filter((request) => request.body).length, 1);
  assertNoSummarySaved();
  assert.notEqual((await loadViewState(tabId))?.subview, "summary");
});

test("history-off, private hosts and selections never create persistent summary cache records", async () => {
  for (const variant of ["history", "private", "selection"]) {
    await setup(
      "openrouter",
      variant === "history"
        ? { saveHistory: false }
        : variant === "private"
          ? { privateHosts: "example.com" }
          : {},
    );
    intercept();
    const selection = variant === "selection";
    const { stream } = await run(
      args(
        "summarize",
        selection
          ? {
              isSelection: true,
              type: "selection",
              finalize: {
                tabId,
                jobId,
                isSelection: true,
                selectionText: "Selected private text",
              },
            }
          : {},
      ),
    );
    assert.equal(stream.error, null);
    assertNoSummarySaved();
    if (!selection)
      assert.equal((await loadViewState(tabId))?.summaryText, undefined);
  }
});

test("turning history off while a remote Summary runs prevents persistence", async () => {
  await setup();
  intercept(async ({ body }) => {
    if (body) await updateSettings({ saveHistory: false });
  });
  const { stream } = await run();
  assert.equal(stream.error, null);
  assertNoSummarySaved();
  assert.equal((await loadViewState(tabId))?.summaryText, undefined);
});

test("a quota failure ends the worker stream with an error and preserves complete retry text", async (t) => {
  await setup();
  intercept();
  const originalSet = chrome.storage.local.set;
  chrome.storage.local.set = async (values) => {
    if (Object.hasOwn(values, "cacheOrder")) {
      const error = new Error("QUOTA_BYTES quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    return originalSet(values);
  };
  t.after(() => {
    chrome.storage.local.set = originalSet;
  });
  const { stream } = await run();
  assert.equal(stream.done, true);
  assert.equal(stream.error, FINALIZE_FAILED_MESSAGE);
  assert.equal(stream.errorUserFacing, true);
  assert.equal(stream.text, "Remote answer");
  assertNoSummarySaved();
  const retry = takePendingFinalize(jobId);
  assert.equal(retry.text, "Remote answer");
  assert.equal(retry.model, models.openrouter);
  assert.equal(retry.finalize.providerType, "openrouter");
  assert.ok(!JSON.stringify(retry).includes("router-secret"));
});

test("trusted extension tabs can attach to a remote stream while content-script ports are rejected", async () => {
  await setup();
  intercept();
  const { streamId } = await run();
  assert.equal(connectListeners.length, 1);
  for (const trusted of [false, true]) {
    const messages = [];
    let disconnected = false;
    const port = {
      name: `popup-stream-${streamId}`,
      sender: {
        id: chrome.runtime.id,
        tab: { id: 202 },
        url: trusted
          ? `${sender.url}?surface=side-panel`
          : "https://example.com/",
      },
      postMessage: (message) => messages.push(message),
      disconnect: () => {
        disconnected = true;
      },
      onDisconnect: { addListener() {} },
    };
    connectListeners[0](port);
    if (trusted) {
      assert.equal(disconnected, false);
      assert.equal(messages[0].type, "chunk");
      assert.equal(messages[0].text, "Remote answer");
      assert.equal(messages.at(-1).type, "done");
    } else {
      assert.equal(disconnected, true);
      assert.deepEqual(messages, []);
    }
  }
});

test("background and multi-tab paths require their separate consent before network calls", async () => {
  await setup();
  const calls = intercept();
  await assert.rejects(
    runBackgroundSummarize({ id: tabId, url }),
    /authorization changed/,
  );
  await assert.rejects(
    summarizeMultiTab([{ id: tabId, url }]),
    /authorization changed/,
  );
  assert.equal(calls.length, 0);
  assert.equal(activeStreams.size, 0);
});

test("B2 background and selected-tabs use both explicit provider models", async () => {
  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async () => ({
    content: "Article evidence with sufficient content.",
    title: "Evidence",
    type: "article",
  });
  for (const provider of Object.keys(models)) {
    await setup(provider, { [`${provider}BackgroundConsent`]: true });
    const calls = intercept();
    await runBackgroundSummarize(
      { id: tabId, url },
      { selectionText: "Selected article evidence with enough content." },
    );
    await waitFor(
      () => [...activeStreams.values()].some((stream) => stream.done),
      "background complete",
    );
    assert.equal(calls.filter((call) => call.body).length, 1);
    assert.equal(calls.find((call) => call.body).body.model, models[provider]);
    const result = await summarizeMultiTab([
      { id: tabId, url },
      { id: tabId + 1, url: "https://example.org/other" },
    ]);
    assert.ok(result.summary);
    const state = await loadViewState(tabId);
    assert.equal(state.providerType, provider);
    assert.equal(state.pageType, "multi-tab");
    assert.equal(state.sourceUrls.includes("https://example.org/other"), true);
    assert.ok(state.promptsCacheKey.includes(":tmulti-tab"));
  }
});

test("B2 background and multi-tab authorization changes prevent result persistence", async () => {
  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async () => ({
    content: "Article evidence with sufficient content.",
    title: "Evidence",
    type: "article",
  });
  for (const provider of Object.keys(models)) {
    for (const path of ["background", "multi-tab"]) {
      for (const patch of [
        { [`${provider}BackgroundConsent`]: false },
        { [`${provider}GenerationConsent`]: false },
        { [`${provider}ApiKey`]: "replacement-key" },
        { [`${provider}Model`]: "changed/model" },
      ]) {
        await setup(provider, { [`${provider}BackgroundConsent`]: true });
        let posts = 0;
        intercept(async (request) => {
          if (request.body && ++posts === 1) {
            const stored = getStorageData().settings;
            await chrome.storage.local.set({
              settings: { ...stored, ...patch },
            });
          }
        });
        if (path === "background") {
          await runBackgroundSummarize(
            { id: tabId, url },
            { selectionText: "Selected article evidence with enough content." },
          );
          await waitFor(
            () => [...activeStreams.values()].some((stream) => stream.done),
            "revoked background complete",
          );
          assert.ok([...activeStreams.values()].some((stream) => stream.error));
        } else {
          await assert.rejects(summarizeMultiTab([{ id: tabId, url }]));
        }
        assertNoSummarySaved();
        assert.notEqual((await loadViewState(tabId))?.subview, "summary");
        assert.equal(posts, 1);
      }
    }
  }
});

test("remote selection capture requires a single-use UI grant", async () => {
  await setup("openrouter", { openrouterBackgroundConsent: true });
  const calls = intercept();
  chrome.tabs.get = async (id) => ({ id, url });
  const selectionSender = {
    id: chrome.runtime.id,
    tab: { id: tabId, url },
    url,
    documentId: "document-a",
  };
  const message = (grant) => ({
    target: "service-worker",
    action: "summarize-selection",
    payload: {
      selectionText: "Selected article evidence with enough content.",
      grant,
    },
  });
  router(message("invalid"), selectionSender, () => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 0);
  const armed = await dispatch("arm-remote-selection", { tabId });
  assert.ok(armed.grant);
  router(message(armed.grant), selectionSender, () => {});
  await waitFor(
    () => [...activeStreams.values()].some((stream) => stream.done),
    "selection complete",
  );
  assert.equal(calls.filter((call) => call.body).length, 1);
  router(message(armed.grant), selectionSender, () => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.filter((call) => call.body).length, 1);
});

test("a local-only selection start cannot adopt a newly selected remote provider", async () => {
  await setup("openrouter", { openrouterBackgroundConsent: true });
  const calls = intercept();
  await assert.rejects(
    runBackgroundSummarize(
      { id: tabId, url },
      {
        localOnly: true,
        selectionText: "Selected article evidence with enough content.",
      },
    ),
    /selection capture again/,
  );
  assert.equal(calls.length, 0);
});

test("B2 native worker permission removal aborts every provider and path", async () => {
  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async () => ({
    content: "Article evidence with sufficient content.",
    title: "Evidence",
    type: "article",
  });
  for (const provider of Object.keys(models)) {
    for (const path of ["background", "multi-tab"]) {
      await setup(provider, { [`${provider}BackgroundConsent`]: true });
      let posts = 0;
      intercept(async (request) => {
        if (request.body) {
          posts++;
          for (const listener of removedPermissionListeners)
            listener({ data_collection: ["websiteContent"] });
        }
      });
      if (path === "background") {
        await runBackgroundSummarize(
          { id: tabId, url },
          { selectionText: "Selected article evidence with enough content." },
        );
        await waitFor(
          () => [...activeStreams.values()].some((stream) => stream.done),
          "permission removed background",
        );
        assert.ok([...activeStreams.values()].some((stream) => stream.error));
      } else await assert.rejects(summarizeMultiTab([{ id: tabId, url }]));
      assert.equal(posts, 1);
      assertNoSummarySaved();
      assert.notEqual((await loadViewState(tabId))?.subview, "summary");
      assert.equal(removedPermissionListeners.size, 0);
    }
  }
});

test("B2 multi-tab rechecks non-owner persistence policy and rolls back an issued write", async () => {
  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async () => ({
    content: "Article evidence with sufficient content.",
    title: "Evidence",
    type: "article",
  });
  const tabs = [
    { id: tabId, url },
    { id: tabId + 1, url: "https://private-source.example/other" },
  ];
  for (const provider of Object.keys(models)) {
    for (const phase of ["generation", "commit"]) {
      await setup(provider, { [`${provider}BackgroundConsent`]: true });
      const prior = await loadViewState(tabId);
      const backingSet = chrome.storage.local.set;
      const changePolicy = () =>
        backingSet({
          settings: {
            ...getStorageData().settings,
            privateHosts: "private-source.example",
          },
        });
      intercept(async (request) => {
        if (phase === "generation" && request.body) await changePolicy();
      });
      let changed = false;
      if (phase === "commit")
        chrome.storage.local.set = async (items) => {
          await backingSet(items);
          if (
            !changed &&
            items[`popupViewState:${tabId}`]?.pageType === "multi-tab"
          ) {
            changed = true;
            await changePolicy();
          }
        };
      try {
        const result = await summarizeMultiTab(tabs);
        assert.ok(result.summary);
        assert.deepEqual(await loadViewState(tabId), prior);
      } finally {
        chrome.storage.local.set = backingSet;
      }
    }
  }
});

test("provider heartbeat and hidden reasoning keep the real worker alive past its cleanup deadline", async (t) => {
  const originalCreate = chrome.alarms.create;
  const originalClear = chrome.alarms.clear;
  let responseController;
  let streamId;
  t.after(() => {
    if (streamId) expireStreamForCleanup(streamId);
    chrome.alarms.create = originalCreate;
    chrome.alarms.clear = originalClear;
    try {
      responseController?.close();
    } catch {
      /* Already closed by cancellation. */
    }
  });
  for (const provider of Object.keys(models)) {
    for (const activity of [
      ": provider heartbeat\n\n",
      'data: {"choices":[{"delta":{"reasoning":"hidden reasoning"}}]}\n\n',
    ]) {
      await setup(provider);
      let now = 0;
      const deadlines = new Map();
      chrome.alarms.create = (name, options) =>
        deadlines.set(name, now + options.delayInMinutes * 60000);
      chrome.alarms.clear = async (name) => deadlines.delete(name);
      intercept(({ body, options }) => {
        if (!body) return;
        return new Response(
          new ReadableStream({
            start(controller) {
              responseController = controller;
              options.signal.addEventListener(
                "abort",
                () => {
                  try {
                    controller.error(new Error("Request aborted"));
                  } catch {
                    /* Already closed. */
                  }
                },
                { once: true },
              );
            },
          }),
        );
      });
      const started = await dispatch("remote-stream", args());
      streamId = started.streamId;
      const stream = activeStreams.get(streamId);
      assert.ok(stream);
      const alarmName = `stream-cleanup:${streamId}`;
      assert.equal(deadlines.get(alarmName), 120000);
      await waitFor(
        () => responseController != null,
        "provider response headers",
      );
      // Only the browser alarm clock advances: no real two-minute wait and no
      // change to catalog freshness or the transport's separate idle timeout.
      for (let elapsed = 20000; elapsed <= 160000; elapsed += 20000) {
        now = elapsed;
        responseController.enqueue(new TextEncoder().encode(activity));
        await waitFor(
          () => deadlines.get(alarmName) === now + 120000,
          "provider activity extends cleanup",
        );
        for (const [name, deadline] of deadlines) {
          if (deadline <= now) {
            deadlines.delete(name);
            for (const listener of alarmListeners) listener({ name });
          }
        }
        assert.equal(activeStreams.get(streamId), stream);
        assert.equal(stream.controller.signal.aborted, false);
        assert.equal(
          stream.text,
          "",
          "hidden activity must not become visible output",
        );
        assertNoSummarySaved();
      }
      responseController.enqueue(
        new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"Completed after reasoning"}}]}\n\ndata: [DONE]\n\n',
        ),
      );
      responseController.close();
      responseController = null;
      await waitFor(
        () => stream.done && !registeredStreamJobs.has(streamId),
        "summary finishes after hidden activity",
      );
      assert.equal(stream.error, null);
      assert.equal(stream.text, "Completed after reasoning");
      assert.equal(
        (await loadViewState(tabId)).summaryText,
        "Completed after reasoning",
      );
      assert.ok((getStorageData().cacheOrder || []).length > 0);
    }
  }
});

test("a remote response without provider activity still expires at the worker deadline", async (t) => {
  await setup();
  const originalCreate = chrome.alarms.create;
  const deadlines = new Map();
  chrome.alarms.create = (name, options) =>
    deadlines.set(name, options.delayInMinutes * 60000);
  t.after(() => {
    chrome.alarms.create = originalCreate;
  });
  intercept(({ body, options }) => {
    if (!body) return;
    return new Response(
      new ReadableStream({
        start(controller) {
          options.signal.addEventListener(
            "abort",
            () => controller.error(new Error("Request aborted")),
            { once: true },
          );
        },
      }),
    );
  });
  const { streamId } = await dispatch("remote-stream", args());
  const stream = activeStreams.get(streamId);
  assert.ok(stream);
  const alarmName = `stream-cleanup:${streamId}`;
  assert.equal(deadlines.get(alarmName), 120000);
  for (const listener of alarmListeners) listener({ name: alarmName });
  await waitFor(
    () => !registeredStreamJobs.has(streamId),
    "expired silent response cleanup",
  );
  assert.equal(activeStreams.has(streamId), false);
  assert.equal(stream.controller.signal.aborted, true);
  assert.equal(stream.done, true);
  assert.match(stream.error, /expired/);
  assertNoSummarySaved();
});

test("a popup can attach when a background selection first publishes its stream id", async () => {
  await setup("openrouter", { openrouterBackgroundConsent: true });
  intercept();
  const backingSet = chrome.storage.local.set;
  const messages = [];
  let publishedStreamId;
  let disconnected = false;
  chrome.storage.local.set = async (items) => {
    await backingSet(items);
    const state = items[`popupViewState:${tabId}`];
    if (publishedStreamId || !state?.streamId || state.pageType !== "selection")
      return;
    publishedStreamId = state.streamId;
    const port = {
      name: `popup-stream-${state.streamId}`,
      sender,
      postMessage: (message) => messages.push(message),
      disconnect: () => {
        disconnected = true;
      },
      onDisconnect: { addListener() {} },
    };
    for (const listener of connectListeners) listener(port);
  };
  try {
    await runBackgroundSummarize(
      { id: tabId, url },
      {
        selectionText: "Selected article evidence with enough content.",
        notifyOnFinish: true,
      },
    );
    assert.ok(publishedStreamId);
    const stream = activeStreams.get(publishedStreamId);
    await waitFor(
      () => stream.done && !registeredStreamJobs.has(publishedStreamId),
      "background selection finalization",
    );
    const state = await loadViewState(tabId);
    assert.equal(state.subview, "summary");
    assert.equal(state.streamId, null);
    assert.equal(state.summaryText, "Remote answer");
    assertNoSummarySaved();
    assert.equal(
      disconnected,
      false,
      "publishing the stream must not expose an unavailable port",
    );
    assert.ok(!messages.some((message) => message.type === "error"));
    assert.equal(messages.at(-1)?.type, "done");
  } finally {
    chrome.storage.local.set = backingSet;
  }
});

test("native selection survives hidden activity and restores after the completed stream expires", async (t) => {
  const originalCreate = chrome.alarms.create;
  let responseController;
  let streamId;
  t.after(() => {
    chrome.alarms.create = originalCreate;
    if (streamId) expireStreamForCleanup(streamId);
    try {
      responseController?.close();
    } catch {
      /* Transport may already be closed. */
    }
  });
  for (const provider of Object.keys(models)) {
    await setup(provider, { [`${provider}BackgroundConsent`]: true });
    let now = 0;
    const deadlines = new Map();
    chrome.alarms.create = (name, options) =>
      deadlines.set(name, now + options.delayInMinutes * 60000);
    intercept(({ body, options }) => {
      if (!body) return;
      return new Response(
        new ReadableStream({
          start(controller) {
            responseController = controller;
            options.signal.addEventListener(
              "abort",
              () => {
                try {
                  controller.error(new Error("Request aborted"));
                } catch {
                  /* Transport may already be closed. */
                }
              },
              { once: true },
            );
          },
        }),
      );
    });
    assert.equal(contextMenuListeners.length, 1);
    await contextMenuListeners[0](
      {
        menuItemId: "apogee-summarize-selection",
        selectionText:
          "A paragraph selected with the native context menu, long enough to summarize.",
      },
      { id: tabId, url },
    );
    await waitFor(
      () =>
        getStorageData()[`popupViewState:${tabId}`]?.streamId &&
        responseController,
      "native selection request",
    );
    streamId = getStorageData()[`popupViewState:${tabId}`].streamId;
    const stream = activeStreams.get(streamId);
    const alarmName = `stream-cleanup:${streamId}`;
    for (now = 20000; now <= 160000; now += 20000) {
      responseController.enqueue(
        new TextEncoder().encode(
          'data: {"choices":[{"delta":{"reasoning":"hidden reasoning"}}]}\n\n',
        ),
      );
      await waitFor(
        () => deadlines.get(alarmName) === now + 120000,
        "native selection activity",
      );
      assert.equal(stream.done, false);
      assert.equal(stream.text, "");
      assert.equal(stream.controller.signal.aborted, false);
    }
    responseController.enqueue(
      new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"Selection summary after reasoning"}}]}\n\ndata: [DONE]\n\n',
      ),
    );
    responseController.close();
    responseController = null;
    await waitFor(
      () => stream.done && !registeredStreamJobs.has(streamId),
      "native selection complete",
    );
    assert.equal(stream.error, null);
    const completed = await loadViewState(tabId);
    assert.equal(completed.subview, "summary");
    assert.equal(completed.streamId, null);
    assert.equal(completed.summaryText, "Selection summary after reasoning");
    assert.equal(completed.isSelection, true);
    assertNoSummarySaved();
    for (const listener of alarmListeners) listener({ name: alarmName });
    assert.equal(activeStreams.has(streamId), false);
    assert.deepEqual(
      await loadViewState(tabId),
      completed,
      "reopening restores completed selection without attaching to expired stream",
    );
  }
});

test("remote startup failures clean prepared streams without inference or stale pending ids", async () => {
  for (const kind of ["foreground", "background"]) {
    for (const failure of ["storage", "revocation", "cancellation"]) {
      await setup("openrouter", { openrouterBackgroundConsent: true });
      const calls = intercept();
      const backingSet = chrome.storage.local.set;
      const originalClear = chrome.alarms.clear;
      const cleared = [];
      const messages = [];
      let disconnected = false;
      let preparedId;
      let failureApplied = false;
      chrome.alarms.clear = async (name) => {
        cleared.push(name);
      };
      chrome.storage.local.set = async (items) => {
        await backingSet(items);
        const state = items[`popupViewState:${tabId}`];
        if (failureApplied || !state?.streamId) return;
        failureApplied = true;
        preparedId = state.streamId;
        const port = {
          name: `popup-stream-${preparedId}`,
          sender,
          postMessage: (message) => messages.push(message),
          disconnect: () => {
            disconnected = true;
          },
          onDisconnect: { addListener() {} },
        };
        for (const listener of connectListeners) listener(port);
        if (failure === "storage")
          throw new Error("Storage unavailable during startup");
        if (failure === "revocation")
          await saveRemoteSettings({
            provider: "openrouter",
            generationConsent: false,
          });
        if (failure === "cancellation")
          await dispatch("cancel-stream", { streamId: preparedId });
      };
      try {
        if (kind === "foreground") {
          const result = await dispatch("remote-stream", args());
          assert.ok(result.error);
          assert.equal(result.streamId, undefined);
        } else {
          await assert.rejects(
            runBackgroundSummarize(
              { id: tabId, url },
              {
                selectionText:
                  "A paragraph selected with enough context for summarizing.",
              },
            ),
          );
        }
        assert.ok(preparedId);
        assert.equal(activeStreams.has(preparedId), false);
        assert.equal(registeredStreamJobs.has(preparedId), false);
        assert.equal((await loadViewState(tabId))?.streamId ?? null, null);
        assert.ok(cleared.includes(`stream-cleanup:${preparedId}`));
        assert.equal(disconnected, true);
        assert.ok(
          messages.some(
            (message) =>
              message.type === "error" || message.type === "cancelled",
          ),
        );
        assert.equal(calls.length, 0);
        assertNoSummarySaved();
        assert.equal(removedPermissionListeners.size, 0);
      } finally {
        chrome.storage.local.set = backingSet;
        chrome.alarms.clear = originalClear;
      }
    }
  }
});

test("native multi-tab failures resolve with a safe failure notification and no ready result", async () => {
  const originalQuery = chrome.tabs.query;
  const originalNotifications = chrome.notifications;
  chrome.scripting = {
    executeScript: async () => [
      { result: chrome.runtime.getManifest().version },
    ],
  };
  chrome.tabs.sendMessage = async () => ({
    content: "Private article evidence must not appear in errors.",
    title: "Private article",
    type: "article",
  });
  try {
    for (const provider of Object.keys(models)) {
      for (const failure of ["tab-query", "provider-response"]) {
        await setup(provider, { [`${provider}BackgroundConsent`]: true });
        const previousState = await loadViewState(tabId);
        const notifications = [];
        chrome.notifications = {
          create(id, options) {
            notifications.push({ id, ...options });
          },
        };
        chrome.tabs.query = async () => {
          if (failure === "tab-query")
            throw new Error("Browser query unavailable.");
          return [{ id: tabId, url }];
        };
        const calls = intercept(({ body }) => {
          if (body)
            return new Response(
              "sensitive-provider-body router-secret code-secret",
              { status: 503 },
            );
        });
        await assert.doesNotReject(
          contextMenuListeners[0](
            { menuItemId: "apogee-summarize-tabs" },
            { id: tabId, url },
          ),
        );
        const failures = notifications.filter(
          (notification) => notification.title === "Summarize failed",
        );
        assert.equal(failures.length, 1);
        assert.ok(failures[0].message.length > 0);
        assert.ok(
          !notifications.some((notification) =>
            /ready/i.test(notification.title),
          ),
        );
        const visible = JSON.stringify(notifications);
        assert.ok(
          !/sensitive-provider-body|router-secret|code-secret|Private article evidence/.test(
            visible,
          ),
        );
        assert.equal(
          calls.filter((call) => call.body).length,
          failure === "provider-response" ? 1 : 0,
        );
        assertNoSummarySaved();
        assert.deepEqual(await loadViewState(tabId), previousState);
        assert.equal(removedPermissionListeners.size, 0);
      }
    }
  } finally {
    chrome.tabs.query = originalQuery;
    if (originalNotifications === undefined) delete chrome.notifications;
    else chrome.notifications = originalNotifications;
  }
});
