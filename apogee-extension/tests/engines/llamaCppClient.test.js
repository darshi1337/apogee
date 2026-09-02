import test from "node:test";
import assert from "node:assert";

import {
  chatStream,
  checkHealth,
  DEFAULT_CONTEXT_TOKENS,
} from "../../lib/engines/llamaCppClient.js";

const HOST = "http://127.0.0.1:8080";

// llama-server frames its stream as `data: {...}` separated by blank lines. The fixtures below are shaped after a real capture from build b10603-c060ca974 serving Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M.
const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const token = (content) =>
  event({ choices: [{ finish_reason: null, index: 0, delta: { content } }] });
const ROLE_OPENER = event({
  choices: [
    {
      finish_reason: null,
      index: 0,
      delta: { role: "assistant", content: null },
    },
  ],
});
const STOP = event({
  choices: [{ finish_reason: "stop", index: 0, delta: {} }],
  timings: { predicted_ms: 12 },
});

function streamingResponse(chunks, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder();
  const state = { cancelled: false };
  const response = {
    ok,
    status,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    }),
    text: async () => chunks.join(""),
  };
  response._state = state;
  return response;
}

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

async function streamTokens(chunks) {
  const restore = stubFetch(async () => streamingResponse(chunks));
  try {
    return await collect(chatStream(HOST, "test-model", "prompt"));
  } finally {
    restore();
  }
}

const STREAM_CASES = [
  {
    name: "yields each token of an ordinary stream in order",
    chunks: [
      ROLE_OPENER,
      token("Hello"),
      token(" world"),
      STOP,
      "data: [DONE]",
    ],
    expected: ["Hello", " world"],
  },
  {
    name: "reassembles an event split across two reads",
    chunks: ['data: {"choi', 'ces":[{"delta":{"content":"split"}}]}\n\n'],
    expected: ["split"],
  },
  {
    name: "skips the role-announcing opener rather than yielding a literal null",
    chunks: [ROLE_OPENER, token("after")],
    expected: ["after"],
  },
  {
    name: "keeps a single-space token, which a truthiness check would drop",
    chunks: [token("a"), token(" "), token("b")],
    expected: ["a", " ", "b"],
  },
  {
    name: "skips the finish_reason chunk carrying an empty delta",
    chunks: [token("done"), STOP],
    expected: ["done"],
  },
  {
    name: "reads a [DONE] sentinel that arrives with no trailing blank line",
    chunks: [token("last"), "data: [DONE]"],
    expected: ["last"],
  },
  {
    name: "stops at [DONE] and ignores anything sent after it",
    chunks: [token("kept"), "data: [DONE]\n\n", token("ignored")],
    expected: ["kept"],
  },
  {
    name: "ignores SSE comment and event-name lines",
    chunks: [
      ": keepalive\n\n",
      'event: message\ndata: {"choices":[{"delta":{"content":"real"}}]}\n\n',
    ],
    expected: ["real"],
  },
];

for (const { name, chunks, expected } of STREAM_CASES) {
  test(`chatStream ${name}`, async () => {
    assert.deepStrictEqual(await streamTokens(chunks), expected);
  });
}

test("chatStream reports timings via onFinalStats when the server sends predicted_n", async () => {
  const finalEvent = event({
    choices: [{ finish_reason: "stop", index: 0, delta: {} }],
    timings: { predicted_n: 84, predicted_ms: 3000 },
  });
  const restore = stubFetch(async () =>
    streamingResponse([token("hi"), finalEvent, "data: [DONE]"]),
  );
  let stats = null;
  try {
    await collect(
      chatStream(HOST, "test-model", "prompt", {
        onFinalStats: (s) => {
          stats = s;
        },
      }),
    );
  } finally {
    restore();
  }
  assert.deepStrictEqual(stats, { tokens: 84, durationMs: 3000 });
});

test("chatStream does not call onFinalStats when timings has no predicted_n", async () => {
  const restore = stubFetch(async () =>
    streamingResponse([token("hi"), STOP, "data: [DONE]"]),
  );
  let called = false;
  try {
    await collect(
      chatStream(HOST, "test-model", "prompt", {
        onFinalStats: () => {
          called = true;
        },
      }),
    );
  } finally {
    restore();
  }
  assert.strictEqual(called, false);
});

test("chatStream throws rather than silently skipping a malformed data payload", async () => {
  const restore = stubFetch(async () =>
    streamingResponse([token("fine"), "data: {not json}\n\n"]),
  );
  try {
    await assert.rejects(
      collect(chatStream(HOST, "test-model", "prompt")),
      /malformed response for model 'test-model'/,
    );
  } finally {
    restore();
  }
});

test("chatStream sanitizes a server_error's raw parser dump", async () => {
  const dump =
    "[json.exception.parse_error.101] parse error at line 1, column 2: syntax error";
  const restore = stubFetch(async () =>
    streamingResponse(
      [
        JSON.stringify({
          error: { message: dump, type: "server_error", code: 500 },
        }),
      ],
      { ok: false, status: 500 },
    ),
  );
  try {
    await assert.rejects(
      collect(chatStream(HOST, "test-model", "prompt")),
      (err) => {
        assert.ok(
          !err.message.includes("json.exception"),
          `raw dump leaked to the user: ${err.message}`,
        );
        assert.match(
          err.message,
          /llama\.cpp failed while handling the request/,
        );
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("chatStream surfaces a request-shaped error message as written", async () => {
  const restore = stubFetch(async () =>
    streamingResponse(
      [
        JSON.stringify({
          error: {
            message: "Expected 'messages' to be an array",
            type: "invalid_request_error",
            code: 400,
          },
        }),
      ],
      { ok: false, status: 400 },
    ),
  );
  try {
    await assert.rejects(
      collect(chatStream(HOST, "test-model", "prompt")),
      /Expected 'messages' to be an array/,
    );
  } finally {
    restore();
  }
});

test("chatStream falls back to the status when an error body is not the usual envelope", async () => {
  const restore = stubFetch(async () =>
    streamingResponse(["<html>502 Bad Gateway</html>"], {
      ok: false,
      status: 502,
    }),
  );
  try {
    await assert.rejects(
      collect(chatStream(HOST, "test-model", "prompt")),
      /502 Bad Gateway/,
    );
  } finally {
    restore();
  }
});

test("chatStream reports a refused connection against the host it tried", async () => {
  const restore = stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  try {
    await assert.rejects(
      collect(chatStream(HOST, "test-model", "prompt")),
      /Could not connect to llama\.cpp at http:\/\/127\.0\.0\.1:8080/,
    );
  } finally {
    restore();
  }
});

test("chatStream reports an aborted request as a cancellation", async () => {
  const restore = stubFetch(async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  });
  try {
    await assert.rejects(
      collect(chatStream(HOST, "test-model", "prompt")),
      /Generation was cancelled/,
    );
  } finally {
    restore();
  }
});

// Errors must carry the UserFacingError marker, or toUserMessage() rewrites them through its fallback table, where "could not connect" matches the Ollama entry and a llama.cpp failure would be reported as an Ollama one.
test("chatStream errors are marked user-facing so they are not remapped", async () => {
  const restore = stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  try {
    await assert.rejects(collect(chatStream(HOST, "m", "p")), (err) => {
      assert.equal(err.isUserFacing, true);
      return true;
    });
  } finally {
    restore();
  }
});

test("chatStream sends no Authorization header when no key is configured", async () => {
  let sent;
  const restore = stubFetch(async (_url, init) => {
    sent = init.headers;
    return streamingResponse([token("hi"), "data: [DONE]"]);
  });
  try {
    await collect(chatStream(HOST, "m", "p"));
    assert.equal(sent.Authorization, undefined);
  } finally {
    restore();
  }
});

test("chatStream sends the API key as a bearer token when one is set", async () => {
  let sent;
  const restore = stubFetch(async (_url, init) => {
    sent = init.headers;
    return streamingResponse([token("hi"), "data: [DONE]"]);
  });
  try {
    await collect(chatStream(HOST, "m", "p", { apiKey: "test-api-key" }));
    assert.equal(sent.Authorization, "Bearer test-api-key");
  } finally {
    restore();
  }
});

// A key that is only whitespace is the same as no key, and sending "Bearer " would turn an unauthenticated server into a 401.
test("chatStream treats a blank API key as no key at all", async () => {
  let sent;
  const restore = stubFetch(async (_url, init) => {
    sent = init.headers;
    return streamingResponse([token("hi"), "data: [DONE]"]);
  });
  try {
    await collect(chatStream(HOST, "m", "p", { apiKey: "   " }));
    assert.equal(sent.Authorization, undefined);
  } finally {
    restore();
  }
});

test("chatStream explains a rejected API key instead of echoing the server", async () => {
  const restore = stubFetch(async () =>
    streamingResponse(
      [
        JSON.stringify({
          error: {
            message: "Invalid API Key",
            type: "authentication_error",
            code: 401,
          },
        }),
      ],
      { ok: false, status: 401 },
    ),
  );
  try {
    await assert.rejects(
      collect(chatStream(HOST, "m", "p", { apiKey: "wrong" })),
      /rejected the API key.*--api-key/s,
    );
  } finally {
    restore();
  }
});

// Cancelling a summary breaks out of the loop partway through. The generator has to release the body then, or the connection is held until the request is garbage collected.
test("chatStream releases the response body when the consumer stops early", async () => {
  let response;
  const restore = stubFetch(async () => {
    response = streamingResponse([
      token("one"),
      token("two"),
      token("three"),
      "data: [DONE]",
    ]);
    return response;
  });
  try {
    for await (const chunk of chatStream(HOST, "m", "p")) {
      if (chunk === "one") break;
    }
    assert.equal(
      response._state.cancelled,
      true,
      "body was not cancelled, so the connection is held",
    );
    assert.equal(response.body.locked, false, "response body left locked");
  } finally {
    restore();
  }
});

test("chatStream reports a mid-stream error arriving after a 200", async () => {
  const restore = stubFetch(async () =>
    streamingResponse([
      token("partial"),
      `data: ${JSON.stringify({
        error: {
          message: "context window exceeded",
          type: "invalid_request_error",
          code: 400,
        },
      })}\n\n`,
    ]),
  );
  try {
    await assert.rejects(
      collect(chatStream(HOST, "test-model", "prompt")),
      /context window exceeded/,
    );
  } finally {
    restore();
  }
});

function routedFetch(routes, onRequest) {
  return async (url, init) => {
    const { pathname } = new URL(url);
    onRequest?.(pathname, init);
    const handler = routes[pathname];
    if (!handler) throw new Error(`unexpected request: ${pathname}`);
    return handler();
  };
}

const ok = (data) => () => ({ ok: true, status: 200, json: async () => data });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });
const unreachable = () => {
  throw new TypeError("fetch failed");
};

const PROPS = { default_generation_settings: { n_ctx: 32768 } };
const MODELS = {
  object: "list",
  data: [
    {
      id: "Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M",
      meta: { n_ctx: 16384, n_ctx_train: 32768 },
    },
  ],
};

async function health(routes) {
  const restore = stubFetch(routedFetch(routes));
  try {
    return await checkHealth(HOST, 50);
  } finally {
    restore();
  }
}

test("checkHealth reports the model and the running context window", async () => {
  const result = await health({
    "/health": ok({ status: "ok" }),
    "/props": ok(PROPS),
    "/v1/models": ok(MODELS),
  });
  assert.deepStrictEqual(result, {
    connected: true,
    models: ["Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M"],
    contextTokens: 32768,
  });
});

// endpoint_props: false is a real server setting, so this path is reachable in normal use rather than only on a broken server.
test("checkHealth falls back to /v1/models meta when /props is disabled", async () => {
  const result = await health({
    "/health": ok({ status: "ok" }),
    "/props": notFound,
    "/v1/models": ok(MODELS),
  });
  assert.equal(result.connected, true);
  assert.equal(result.contextTokens, 16384);
});

test("checkHealth leaves contextTokens null when neither endpoint reports one", async () => {
  const result = await health({
    "/health": ok({ status: "ok" }),
    "/props": notFound,
    "/v1/models": ok({ data: [{ id: "some-model" }] }),
  });
  assert.equal(result.connected, true);
  assert.equal(result.contextTokens, null);
  assert.deepStrictEqual(result.models, ["some-model"]);
});

test("checkHealth stays connected when both enrichment lookups fail", async () => {
  const result = await health({
    "/health": ok({ status: "ok" }),
    "/props": unreachable,
    "/v1/models": unreachable,
  });
  assert.deepStrictEqual(result, {
    connected: true,
    models: [],
    contextTokens: null,
  });
});

// Verified against b10603: /health is public but /props and /v1/models are both guarded, so a bad key looks like a reachable server with nothing on it. The UI needs that pair to tell a bad key from an idle server.
test("checkHealth with a rejected key stays connected but reports nothing", async () => {
  const rejected = () => ({
    ok: false,
    status: 401,
    json: async () => ({
      error: { message: "Invalid API Key", type: "authentication_error" },
    }),
  });
  const result = await health({
    "/health": ok({ status: "ok" }),
    "/props": rejected,
    "/v1/models": rejected,
  });
  assert.deepStrictEqual(result, {
    connected: true,
    models: [],
    contextTokens: null,
  });
});

test("checkHealth lists every model when a proxy is serving several", async () => {
  const result = await health({
    "/health": ok({ status: "ok" }),
    "/props": notFound,
    "/v1/models": ok({
      data: [{ id: "model-a" }, { id: "model-b" }, { id: "model-c" }],
    }),
  });
  assert.deepStrictEqual(result.models, ["model-a", "model-b", "model-c"]);
});

test("checkHealth reports a non-ok /health as disconnected", async () => {
  const result = await health({
    "/health": () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.deepStrictEqual(result, {
    connected: false,
    models: [],
    contextTokens: null,
  });
});

test("checkHealth reports an unreachable server as disconnected instead of throwing", async () => {
  const result = await health({ "/health": unreachable });
  assert.deepStrictEqual(result, {
    connected: false,
    models: [],
    contextTokens: null,
  });
});

// Which endpoints --api-key guards has changed between llama-server versions, so the key goes on all three rather than a guessed subset.
test("checkHealth authenticates every lookup, not just the guarded ones", async () => {
  const seen = new Map();
  const restore = stubFetch(
    routedFetch(
      {
        "/health": ok({ status: "ok" }),
        "/props": ok(PROPS),
        "/v1/models": ok(MODELS),
      },
      (pathname, init) => seen.set(pathname, init?.headers?.Authorization),
    ),
  );
  try {
    await checkHealth(HOST, 50, "test-api-key");
  } finally {
    restore();
  }
  assert.deepStrictEqual([...seen.entries()].sort(), [
    ["/health", "Bearer test-api-key"],
    ["/props", "Bearer test-api-key"],
    ["/v1/models", "Bearer test-api-key"],
  ]);
});

test("DEFAULT_CONTEXT_TOKENS is small enough to be safe on an unreported window", () => {
  assert.equal(DEFAULT_CONTEXT_TOKENS, 8192);
});
