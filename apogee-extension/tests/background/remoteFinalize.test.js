import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";

const { chrome } = createExtensionApiMock({
  settings: { saveHistory: true, provider: "webllm" },
});
const sentMessages = [];
chrome.alarms = { create() {} };
chrome.runtime.sendMessage = async (message) => {
  sentMessages.push(message);
};
globalThis.chrome = chrome;

const { buildTrustedFinalize, recordPopupSummaryStream, finalizeSummaryJob } =
  await import("../../background/finalize.js");
const { runSuggestQuestionsJob } =
  await import("../../background/suggestQuestions.js");
const { saveViewState, loadViewState } =
  await import("../../lib/storage/viewState.js");
const { getSummaryAndPromptsCacheKeys } =
  await import("../../ui/promptsContext.js");

function holdStorageRead(matches) {
  const backingGet = chrome.storage.local.get;
  let signalRead;
  let release;
  const started = new Promise((resolve) => {
    signalRead = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  chrome.storage.local.get = async (keys) => {
    const result = await backingGet(keys);
    if (matches(keys)) {
      signalRead();
      await released;
    }
    return result;
  };
  return {
    started,
    release,
    restore: () => {
      chrome.storage.local.get = backingGet;
    },
  };
}

function holdStorageWrite(matches) {
  const backingSet = chrome.storage.local.set;
  let signalWrite;
  let release;
  let held = false;
  const started = new Promise((resolve) => {
    signalWrite = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  chrome.storage.local.set = async (items) => {
    await backingSet(items);
    if (!held && matches(items)) {
      held = true;
      signalWrite();
      await released;
    }
  };
  return {
    started,
    release,
    restore: () => {
      chrome.storage.local.set = backingSet;
    },
  };
}

test("pinned remote finalization ignores payload identity and records execution provenance", async () => {
  const url = "https://example.com/pinned-execution";
  const settings = {
    provider: "openrouter",
    openrouterModel: "same/model:version",
    openrouterApiKey: "secret-must-not-be-stored",
    responseFormat: "bullets",
    summaryLanguage: "es",
    translationEngine: "llm",
    customInstructions: "Use short sentences",
  };
  const finalize = await buildTrustedFinalize(
    {
      url,
      type: "article",
      model: "caller/override",
      providerType: "opencode",
      finalize: {
        tabId: 443,
        jobId: "remote-pinned",
        model: "nested/override",
        providerType: "local",
      },
    },
    settings,
  );
  assert.equal(finalize.providerType, "openrouter");
  assert.equal(finalize.model, settings.openrouterModel);
  const keys = await getSummaryAndPromptsCacheKeys(
    url,
    settings,
    settings.openrouterModel,
    "",
    { pageType: "article" },
  );
  assert.equal(finalize.cacheKey, keys.cacheKey);
  assert.equal(finalize.promptsCacheKey, keys.promptsCacheKey);
  assert.ok(!JSON.stringify(finalize).includes(settings.openrouterApiKey));
  await saveViewState(443, {
    url,
    subview: "summarizing",
    jobId: finalize.jobId,
    providerType: "local",
    model: "previous-model",
  });
  await recordPopupSummaryStream(
    { url, finalize, model: "caller/override" },
    "remote-stream",
  );
  let state = await loadViewState(443);
  assert.equal(state.providerType, "openrouter");
  assert.equal(state.model, settings.openrouterModel);
  const result = await finalizeSummaryJob({
    finalize,
    url,
    model: "another/override",
    text: "Finished remote summary.",
  });
  assert.equal(result.ok, true);
  state = await loadViewState(443);
  assert.equal(state.providerType, "openrouter");
  assert.equal(state.model, settings.openrouterModel);
  assert.equal(state.summaryText, "Finished remote summary.");
  assert.ok(!JSON.stringify(state).includes(settings.openrouterApiKey));
});

test("remote suggestions do not start generation, offscreen work, or fetches", async () => {
  let offscreenCalls = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("Unexpected fetch");
  };
  sentMessages.length = 0;
  try {
    for (const providerType of ["openrouter", "opencode"]) {
      await runSuggestQuestionsJob(
        { providerType, promptsCacheKey: `suggested-prompts:${providerType}` },
        { ensureOffscreenDocument: async () => offscreenCalls++ },
      );
    }
    assert.equal(offscreenCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(sentMessages, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("revoked remote finalization skips writes and cannot preserve an authorized retry", async () => {
  const { pendingFinalizeRetries } =
    await import("../../background/finalize.js");
  const finalize = await buildTrustedFinalize(
    { url: "https://example.com/revoked", finalize: { jobId: "revoked" } },
    {
      provider: "openrouter",
      openrouterModel: "remote/model",
      responseFormat: "bullets",
      summaryLanguage: "auto",
    },
  );
  await assert.rejects(
    finalizeSummaryJob(
      { finalize, text: "Must not save" },
      {
        assertAuthorized: () => {
          throw new Error("Revoked");
        },
      },
    ),
    /Revoked/,
  );
  const stored = await chrome.storage.local.get(finalize.cacheKey);
  assert.equal(stored[finalize.cacheKey], undefined);
  assert.equal(pendingFinalizeRetries.has("revoked"), false);
});

test("revocation during cache-index read prevents the remote summary commit and retry", async () => {
  const { pendingFinalizeRetries } =
    await import("../../background/finalize.js");
  const finalize = await buildTrustedFinalize(
    {
      url: "https://example.com/cache-race",
      finalize: { jobId: "cache-race" },
    },
    {
      provider: "openrouter",
      openrouterModel: "remote/model",
      responseFormat: "bullets",
      summaryLanguage: "auto",
    },
  );
  const before = await chrome.storage.local.get("cacheOrder");
  let authorized = true;
  const held = holdStorageRead(
    (keys) =>
      keys === "cacheOrder" ||
      (Array.isArray(keys) && keys.includes("cacheOrder")),
  );
  try {
    const running = finalizeSummaryJob(
      { finalize, text: "Must not commit after revoke" },
      {
        assertAuthorized: () => {
          if (!authorized) throw new Error("Revoked");
        },
      },
    );
    await held.started;
    authorized = false;
    held.release();
    await assert.rejects(running, /Revoked/);
  } finally {
    held.release();
    held.restore();
  }
  const stored = await chrome.storage.local.get([
    finalize.cacheKey,
    "cacheOrder",
  ]);
  assert.equal(stored[finalize.cacheKey], undefined);
  assert.deepEqual(stored.cacheOrder, before.cacheOrder);
  assert.equal(pendingFinalizeRetries.has("cache-race"), false);
});

test("revocation during view-state read prevents stale remote completion and retry", async () => {
  const { pendingFinalizeRetries } =
    await import("../../background/finalize.js");
  const tabId = 444;
  const finalize = await buildTrustedFinalize(
    {
      url: "https://example.com/view-race",
      finalize: { jobId: "view-race", tabId, isSelection: true },
    },
    {
      provider: "opencode",
      opencodeModel: "remote/model",
      responseFormat: "bullets",
      summaryLanguage: "auto",
    },
  );
  await saveViewState(tabId, {
    jobId: finalize.jobId,
    subview: "summarizing",
    summaryText: "Previous state",
  });
  const before = await loadViewState(tabId);
  let authorized = true;
  const held = holdStorageRead(
    (keys) => Array.isArray(keys) && keys.includes(`popupViewState:${tabId}`),
  );
  try {
    const running = finalizeSummaryJob(
      { finalize, text: "Must not complete after revoke" },
      {
        assertAuthorized: () => {
          if (!authorized) throw new Error("Cancelled");
        },
      },
    );
    await held.started;
    authorized = false;
    held.release();
    await assert.rejects(running, /Cancelled/);
  } finally {
    held.release();
    held.restore();
  }
  assert.deepEqual(await loadViewState(tabId), before);
  assert.equal(pendingFinalizeRetries.has("view-race"), false);
});

for (const priorExists of [false, true]) {
  test(`revocation during issued cache write restores ${priorExists ? "previous summary" : "absent entry"} and index`, async () => {
    const { pendingFinalizeRetries } =
      await import("../../background/finalize.js");
    const jobId = `issued-cache-${priorExists}`;
    const finalize = await buildTrustedFinalize(
      { url: `https://example.com/${jobId}`, finalize: { jobId } },
      {
        provider: "openrouter",
        openrouterModel: "remote/model",
        responseFormat: "bullets",
        summaryLanguage: "auto",
      },
    );
    if (priorExists) {
      await chrome.storage.local.set({
        [finalize.cacheKey]: "Prior authorized summary",
        cacheOrder: [
          {
            s: finalize.cacheKey,
            p: finalize.promptsCacheKey,
            t: "Prior title",
          },
        ],
      });
    } else {
      await chrome.storage.local.remove([finalize.cacheKey, "cacheOrder"]);
    }
    const keys = [finalize.cacheKey, "cacheOrder"];
    const before = await chrome.storage.local.get(keys);
    let authorized = true;
    const held = holdStorageWrite((items) =>
      Object.hasOwn(items, finalize.cacheKey),
    );
    try {
      const running = finalizeSummaryJob(
        { finalize, text: "Revoked result" },
        {
          assertAuthorized: () => {
            if (!authorized) throw new Error("Revoked");
          },
        },
      );
      await held.started;
      authorized = false;
      held.release();
      await assert.rejects(running, /Revoked/);
    } finally {
      held.release();
      held.restore();
    }
    assert.deepEqual(await chrome.storage.local.get(keys), before);
    assert.equal(pendingFinalizeRetries.has(jobId), false);
  });
}

test("revocation during issued view-state write restores previous state and index", async () => {
  const { pendingFinalizeRetries } =
    await import("../../background/finalize.js");
  const tabId = 445;
  const jobId = "issued-view";
  const finalize = await buildTrustedFinalize(
    {
      url: "https://example.com/issued-view",
      finalize: { jobId, tabId, isSelection: true },
    },
    {
      provider: "opencode",
      opencodeModel: "remote/model",
      responseFormat: "bullets",
      summaryLanguage: "auto",
    },
  );
  await saveViewState(tabId, {
    jobId,
    subview: "summarizing",
    summaryText: "Previous summary",
  });
  const key = `popupViewState:${tabId}`;
  const keys = [key, "viewStateOrder"];
  const before = await chrome.storage.local.get(keys);
  let authorized = true;
  const held = holdStorageWrite((items) => Object.hasOwn(items, key));
  try {
    const running = finalizeSummaryJob(
      { finalize, text: "Revoked completion" },
      {
        assertAuthorized: () => {
          if (!authorized) throw new Error("Revoked");
        },
      },
    );
    await held.started;
    authorized = false;
    held.release();
    await assert.rejects(running, /Revoked/);
  } finally {
    held.release();
    held.restore();
  }
  assert.deepEqual(await chrome.storage.local.get(keys), before);
  assert.equal(pendingFinalizeRetries.has(jobId), false);
});

for (const priorExists of [false, true]) {
  test(`revocation during issued view-state commit rolls back ${priorExists ? "the previous" : "the new"} remote summary`, async () => {
    const { pendingFinalizeRetries } =
      await import("../../background/finalize.js");
    const tabId = 446 + Number(priorExists);
    const jobId = `issued-view-cache-${priorExists}`;
    const finalize = await buildTrustedFinalize(
      {
        url: `https://example.com/${jobId}`,
        finalize: { jobId, tabId },
      },
      {
        provider: "openrouter",
        openrouterModel: "remote/model",
        responseFormat: "bullets",
        summaryLanguage: "auto",
      },
    );
    if (priorExists) {
      await chrome.storage.local.set({
        [finalize.cacheKey]: "Prior authorized summary",
        cacheOrder: [
          {
            s: finalize.cacheKey,
            p: finalize.promptsCacheKey,
            t: "Prior title",
          },
        ],
      });
    } else {
      await chrome.storage.local.remove([finalize.cacheKey, "cacheOrder"]);
    }
    await saveViewState(tabId, {
      jobId,
      subview: "summarizing",
      summaryText: "Previous state",
    });
    const viewKey = `popupViewState:${tabId}`;
    const keys = [finalize.cacheKey, "cacheOrder", viewKey, "viewStateOrder"];
    const before = await chrome.storage.local.get(keys);
    let authorized = true;
    const held = holdStorageWrite((items) => Object.hasOwn(items, viewKey));
    try {
      const running = finalizeSummaryJob(
        { finalize, text: "Revoked result" },
        {
          assertAuthorized: () => {
            if (!authorized) throw new Error("Revoked");
          },
        },
      );
      await held.started;
      authorized = false;
      held.release();
      await assert.rejects(running, /Revoked/);
    } finally {
      held.release();
      held.restore();
    }
    assert.deepEqual(await chrome.storage.local.get(keys), before);
    assert.equal(pendingFinalizeRetries.has(jobId), false);
  });
}
