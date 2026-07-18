import test from "node:test";
import assert from "node:assert";

import { getMaxChunkChars } from "../lib/modelLimits.js";

test("getMaxChunkChars caps WebLLM's uniformly small context window", () => {
  // All four WebLLM model IDs are configured at context_window_size: 4096
  // by @mlc-ai/web-llm regardless of the base model (see modelLimits.js's
  // comment). (4096 - 2048 reserved) * 4 chars/token = 8192.
  assert.equal(getMaxChunkChars("Qwen2.5-1.5B-Instruct-q4f16_1-MLC"), 8192);
  assert.equal(getMaxChunkChars("Phi-3.5-mini-instruct-q4f16_1-MLC"), 8192);
});

test("getMaxChunkChars gives large-context Ollama models more room, capped in practice", () => {
  // llama3.1 advertises 128k tokens, but that's capped to the 24000-token
  // practical ceiling: (24000 - 2048) * 4 = 87808.
  assert.equal(getMaxChunkChars("llama3.1:8b"), 87808);
  assert.equal(getMaxChunkChars("llama3.1:70b-instruct-q4_0"), 87808);
});

test("getMaxChunkChars matches the longer, more specific model-family prefix first", () => {
  // qwen2.5 (32768) must win over the shorter "qwen2"/"qwen" prefixes
  // (which would otherwise also match via startsWith). Also above the
  // 24000-token practical cap, so it lands on the same budget as the
  // 128k-rated families above: (24000 - 2048) * 4 = 87808.
  assert.equal(getMaxChunkChars("qwen2.5:7b"), 87808);
  // Sanity check the prefix ordering actually matters: the shorter "qwen"
  // family alone is only rated 8192 tokens, a materially smaller budget.
  assert.notEqual(getMaxChunkChars("qwen2.5:7b"), getMaxChunkChars("qwen:7b"));
});

test("getMaxChunkChars gives a smaller-context Ollama family less room than a large one", () => {
  // mistral: 8192 tokens, (8192 - 2048) * 4 = 24576.
  assert.equal(getMaxChunkChars("mistral:latest"), 24576);
});

test("getMaxChunkChars falls back to a conservative default for an unrecognized model", () => {
  // Default 8192 tokens, same arithmetic as the mistral case above.
  assert.equal(getMaxChunkChars("some-custom-finetune:latest"), 24576);
});
