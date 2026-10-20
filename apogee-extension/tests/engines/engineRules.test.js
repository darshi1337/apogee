import test from "node:test";
import assert from "node:assert/strict";

import {
  INPUT_KINDS,
  DEFAULT_CANDIDATES,
  DEFAULT_KIND_CANDIDATES,
  detectInputKind,
  resolveCandidateChain,
} from "../../lib/engines/engineRules.js";
import { PROVIDERS, DEFAULT_SETTINGS } from "../../lib/constants.js";

const makeSettings = (overrides = {}) => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

test("detectInputKind identifies each input kind accurately", () => {
  assert.equal(detectInputKind({ action: "ask" }), INPUT_KINDS.ASK);
  assert.equal(detectInputKind({ isSelection: true }), INPUT_KINDS.SELECTION);
  assert.equal(detectInputKind({ type: "selection" }), INPUT_KINDS.SELECTION);

  assert.equal(detectInputKind({ isPdf: true }), INPUT_KINDS.DOCUMENT);
  assert.equal(detectInputKind({ title: "report.PDF" }), INPUT_KINDS.DOCUMENT);
  assert.equal(detectInputKind({ title: "notes.docx" }), INPUT_KINDS.DOCUMENT);
  assert.equal(
    detectInputKind({ url: "https://example.com/paper.pdf" }),
    INPUT_KINDS.DOCUMENT,
  );
  assert.equal(
    detectInputKind({ url: "https://example.com/paper.pdf?download=1#page=2" }),
    INPUT_KINDS.DOCUMENT,
  );
  assert.equal(
    detectInputKind({ url: "https://example.com/page?file=paper.pdf" }),
    INPUT_KINDS.ARTICLE,
  );

  assert.equal(detectInputKind({ type: "youtube" }), INPUT_KINDS.VIDEO);
  assert.equal(detectInputKind({ type: "bilibili" }), INPUT_KINDS.VIDEO);

  assert.equal(detectInputKind({ type: "reddit" }), INPUT_KINDS.DISCUSSION);
  assert.equal(detectInputKind({ type: "hackernews" }), INPUT_KINDS.DISCUSSION);
  assert.equal(
    detectInputKind({ type: "stackoverflow" }),
    INPUT_KINDS.DISCUSSION,
  );
  assert.equal(detectInputKind({ type: "discourse" }), INPUT_KINDS.DISCUSSION);
  assert.equal(detectInputKind({ type: "bluesky" }), INPUT_KINDS.DISCUSSION);
  assert.equal(detectInputKind({ type: "mastodon" }), INPUT_KINDS.DISCUSSION);

  assert.equal(detectInputKind({ type: "article" }), INPUT_KINDS.ARTICLE);
  assert.equal(detectInputKind({ type: "generic" }), INPUT_KINDS.ARTICLE);
  assert.equal(detectInputKind({}), INPUT_KINDS.ARTICLE);
});

test("DEFAULT_CANDIDATES ranks in-browser engines ahead of local daemons", () => {
  const webllmIdx = DEFAULT_CANDIDATES.indexOf(PROVIDERS.WEBLLM);
  const transformersIdx = DEFAULT_CANDIDATES.indexOf(PROVIDERS.TRANSFORMERS);
  const localIdx = DEFAULT_CANDIDATES.indexOf(PROVIDERS.LOCAL);
  const llamaIdx = DEFAULT_CANDIDATES.indexOf(PROVIDERS.LLAMACPP);

  if (webllmIdx !== -1 && localIdx !== -1) {
    assert.ok(
      webllmIdx < localIdx,
      "webllm should rank ahead of local daemons",
    );
  }
  if (transformersIdx !== -1 && localIdx !== -1) {
    assert.ok(
      transformersIdx < localIdx,
      "transformers should rank ahead of local daemons",
    );
  }
  if (webllmIdx !== -1 && llamaIdx !== -1) {
    assert.ok(webllmIdx < llamaIdx, "webllm should rank ahead of llama.cpp");
  }
  if (transformersIdx !== -1 && llamaIdx !== -1) {
    assert.ok(
      transformersIdx < llamaIdx,
      "transformers should rank ahead of llama.cpp",
    );
  }
});

test("resolveCandidateChain returns undefined when autoEngine is false", () => {
  const settings = makeSettings({ autoEngine: false });
  assert.equal(
    resolveCandidateChain({
      kind: INPUT_KINDS.ARTICLE,
      tokenCount: 500,
      settings,
    }),
    undefined,
  );
});

test("resolveCandidateChain resolves candidates when autoEngine is true", () => {
  const settings = makeSettings({
    autoEngine: true,
    llamaApiKey: "key123",
  });
  const chain = resolveCandidateChain({
    kind: INPUT_KINDS.ARTICLE,
    tokenCount: 500,
    settings,
  });
  assert.ok(Array.isArray(chain));
  assert.equal(chain[0], PROVIDERS.WEBLLM);
  assert.equal(chain[1], PROVIDERS.TRANSFORMERS);
});

test("resolveCandidateChain promotes local engine only when settings.provider is that engine", () => {
  const settings = makeSettings({
    autoEngine: true,
    provider: PROVIDERS.LOCAL,
    llamaApiKey: "key123",
  });
  const chain = resolveCandidateChain({
    kind: INPUT_KINDS.ARTICLE,
    tokenCount: 500,
    settings,
  });
  assert.equal(chain[0], PROVIDERS.LOCAL);
});

test("resolveCandidateChain pre-filters engines lacking credentials via providerNeedsKey", () => {
  const settings = makeSettings({
    autoEngine: true,
    llamaApiKey: "", // missing API key
  });
  const chain = resolveCandidateChain({
    kind: INPUT_KINDS.ARTICLE,
    tokenCount: 500,
    settings,
  });
  assert.ok(!chain.includes(PROVIDERS.LLAMACPP));
});

test("resolveCandidateChain appends remaining available engines after rule list", () => {
  DEFAULT_KIND_CANDIDATES[INPUT_KINDS.SELECTION] = [PROVIDERS.TRANSFORMERS];
  try {
    const available = [
      PROVIDERS.LOCAL,
      PROVIDERS.TRANSFORMERS,
      PROVIDERS.WEBLLM,
      PROVIDERS.LLAMACPP,
    ];
    const settings = makeSettings({
      autoEngine: true,
      llamaApiKey: "key",
    });
    const chain = resolveCandidateChain({
      kind: INPUT_KINDS.SELECTION,
      tokenCount: 500,
      settings,
      availableEngines: available,
    });
    assert.equal(chain[0], PROVIDERS.TRANSFORMERS);
    assert.ok(chain.includes(PROVIDERS.WEBLLM));
    assert.ok(chain.includes(PROVIDERS.LOCAL));
    assert.ok(chain.includes(PROVIDERS.LLAMACPP));
  } finally {
    delete DEFAULT_KIND_CANDIDATES[INPUT_KINDS.SELECTION];
  }
});

test("resolveCandidateChain falls back to DEFAULT_CANDIDATES when kind has no override", () => {
  const settings = makeSettings({
    autoEngine: true,
    llamaApiKey: "key",
  });
  const chain = resolveCandidateChain({
    kind: INPUT_KINDS.SELECTION,
    tokenCount: 500,
    settings,
  });
  assert.equal(chain[0], PROVIDERS.WEBLLM);
  assert.equal(chain[1], PROVIDERS.TRANSFORMERS);
});

test("resolveCandidateChain demotes engines whose usable context window < tokenCount", () => {
  // WebLLM usable context: 4096 - 2048 = 2048 tokens
  // Transformers usable context: 3072 - 2048 = 1024 tokens
  // Ollama llama3.1 usable context: 24000 - 2048 = 21952 tokens
  const settings = makeSettings({
    autoEngine: true,
    localModel: "llama3.1:8b",
    llamaApiKey: "key",
  });

  // At 1500 tokens: Transformers (1024) is demoted, WebLLM (2048) and Ollama (21952) fit
  const chain = resolveCandidateChain({
    kind: INPUT_KINDS.ARTICLE,
    tokenCount: 1500,
    settings,
  });
  assert.equal(chain[0], PROVIDERS.WEBLLM);
  assert.equal(chain[1], PROVIDERS.LOCAL);
  assert.ok(
    chain.indexOf(PROVIDERS.TRANSFORMERS) > chain.indexOf(PROVIDERS.LOCAL),
  );
});

test("resolveCandidateChain keeps original order if all engines are demoted", () => {
  const settings = makeSettings({
    autoEngine: true,
    localModel: "llama3.1:8b",
    llamaApiKey: "key",
  });
  // Token count exceeding practical max (24000 - 2048 = 21952)
  const hugeTokenCount = 50000;
  const chain = resolveCandidateChain({
    kind: INPUT_KINDS.ARTICLE,
    tokenCount: hugeTokenCount,
    settings,
  });
  // All are demoted, so original order is preserved
  assert.equal(chain[0], PROVIDERS.WEBLLM);
  assert.equal(chain[1], PROVIDERS.TRANSFORMERS);
  assert.equal(chain[2], PROVIDERS.LOCAL);
});

test("resolveCandidateChain respects injectable availableEngines list", () => {
  const settings = makeSettings({
    autoEngine: true,
    llamaApiKey: "key",
  });
  const noWebllm = [
    PROVIDERS.TRANSFORMERS,
    PROVIDERS.LOCAL,
    PROVIDERS.LLAMACPP,
  ];
  const chain = resolveCandidateChain({
    kind: INPUT_KINDS.ARTICLE,
    tokenCount: 500,
    settings,
    availableEngines: noWebllm,
  });
  assert.ok(!chain.includes(PROVIDERS.WEBLLM));
  assert.equal(chain[0], PROVIDERS.TRANSFORMERS);
});
