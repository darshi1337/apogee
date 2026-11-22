import test from "node:test";
import assert from "node:assert";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A get on a gated key parks until the test releases it, so the first
// context keeps its Web Lock while the second context tries to enter.
function installGatedStorage({ gateKeys, initial = {} }) {
  const data = { ...initial };
  const events = [];
  let armed = true;
  let releaseGate;
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const names =
            keys == null ? null : Array.isArray(keys) ? keys : [keys];
          events.push({ op: "get", keys: names });
          if (
            armed &&
            (names === null || gateKeys.some((key) => names.includes(key)))
          ) {
            armed = false;
            startedResolve();
            await new Promise((resolve) => {
              releaseGate = resolve;
            });
          }
          if (names == null) return { ...data };
          const out = {};
          for (const key of names) out[key] = data[key];
          return out;
        },
        set: async (obj) => {
          events.push({ op: "set", keys: Object.keys(obj) });
          Object.assign(data, obj);
        },
        remove: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          events.push({ op: "remove", keys: names });
          for (const key of names) delete data[key];
        },
      },
    },
  };

  return {
    data,
    events,
    started,
    release: () => releaseGate?.(),
  };
}

const gets = (events, key) =>
  events.filter((event) => event.op === "get" && event.keys?.includes(key));

test("page cache writes serialize across popup and worker contexts (#634)", async () => {
  const gate = installGatedStorage({ gateKeys: ["cacheOrder"] });
  const worker = await import("../../lib/storage/pageCache.js?context=worker");
  const popup = await import("../../lib/storage/pageCache.js?context=popup");

  const write = worker.persistSummary(
    "summary:context",
    "prompts:context",
    "Summary text",
    "Title",
  );
  await gate.started;

  const clear = popup.clearCachedPages();
  await delay(20);
  assert.strictEqual(
    gets(gate.events, "cacheOrder").length,
    1,
    "the clear must wait for the write to leave the shared lock",
  );

  gate.release();
  await Promise.all([write, clear]);
  assert.strictEqual(gate.data["summary:context"], undefined);
});

test("view-state writes serialize across popup and worker contexts (#634)", async () => {
  const gate = installGatedStorage({
    gateKeys: ["viewStateOrder"],
    initial: { settings: { saveHistory: true } },
  });
  const worker = await import("../../lib/storage/viewState.js?context=worker");
  const popup = await import("../../lib/storage/viewState.js?context=popup");

  const write = worker.saveViewState(7, {
    view: "summaryView",
    summaryText: "Summary text",
    url: "https://example.com/context",
  });
  await gate.started;

  const clear = popup.clearAllViewStates();
  await delay(20);
  assert.strictEqual(
    gets(gate.events, "viewStateOrder").length,
    1,
    "the clear must wait for the write to leave the shared lock",
  );

  gate.release();
  await Promise.all([write, clear]);
  assert.strictEqual(gate.data["popupViewState:7"], undefined);
});
