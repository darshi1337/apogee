import test from "node:test";
import assert from "node:assert";

import { LLAMACPP_PROVIDER } from "../../background/loopbackProviders.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../lib/engines/llamaCppClient.js";

const HOST = "http://127.0.0.1:8080";

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const badRequest = () => ({ ok: false, status: 400, json: async () => ({}) });

test("getContextTokens asks for the selected model before the general health check", async () => {
  const seen = [];
  const restore = stubFetch(async (url) => {
    const { pathname, searchParams } = new URL(url);
    const model = searchParams.get("model");
    seen.push(model ? `${pathname}?model=${model}` : pathname);
    return ok({ default_generation_settings: { n_ctx: 4096 } });
  });
  try {
    const result = await LLAMACPP_PROVIDER.getContextTokens(
      HOST,
      "",
      "model-b",
    );
    assert.equal(result, 4096);
  } finally {
    restore();
  }
  assert.deepStrictEqual(seen, ["/props?model=model-b"]);
});

test("getContextTokens falls back to the default when a router only reports another model's window", async () => {
  const restore = stubFetch(async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/props" && searchParams.get("model")) {
      return badRequest();
    }
    if (pathname === "/health") return ok({ status: "ok" });
    if (pathname === "/props") {
      return ok({
        role: "router",
        default_generation_settings: { n_ctx: 0 },
      });
    }
    if (pathname === "/v1/models") {
      return ok({
        data: [
          { id: "loaded-large", meta: { n_ctx: 32768 } },
          { id: "unloaded-small" },
        ],
      });
    }
    throw new Error(`unexpected request: ${pathname}`);
  });
  try {
    const result = await LLAMACPP_PROVIDER.getContextTokens(
      HOST,
      "",
      "unloaded-small",
    );
    assert.equal(result, DEFAULT_CONTEXT_TOKENS);
  } finally {
    restore();
  }
});
