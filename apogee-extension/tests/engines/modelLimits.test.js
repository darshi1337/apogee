import test from "node:test";
import assert from "node:assert";

import {
  getMaxChunkChars,
  getMaxChunks,
} from "../../lib/engines/modelLimits.js";
import { TRANSFORMERS_MODELS } from "../../lib/constants.js";

test("getMaxChunkChars caps WebLLM's uniformly small context window", () => {
  assert.equal(getMaxChunkChars("Qwen2.5-1.5B-Instruct-q4f16_1-MLC"), 8192);
  assert.equal(getMaxChunkChars("Phi-3.5-mini-instruct-q4f16_1-MLC"), 8192);
});

test("getMaxChunkChars gives large-context Ollama models more room, capped in practice", () => {
  assert.equal(getMaxChunkChars("llama3.1:8b"), 87808);
  assert.equal(getMaxChunkChars("llama3.1:70b-instruct-q4_0"), 87808);
});

test("getMaxChunkChars matches the longer, more specific model-family prefix first", () => {
  assert.equal(getMaxChunkChars("qwen2.5:7b"), 87808);
  assert.notEqual(getMaxChunkChars("qwen2.5:7b"), getMaxChunkChars("qwen:7b"));
});

test("getMaxChunkChars gives a smaller-context Ollama family less room than a large one", () => {
  assert.equal(getMaxChunkChars("mistral:latest"), 24576);
});

test("getMaxChunkChars falls back to a conservative default for an unrecognized model", () => {
  assert.equal(getMaxChunkChars("some-custom-finetune:latest"), 24576);
});

test("getMaxChunkChars caps Transformers.js's WASM/CPU budget below even WebLLM's", () => {
  for (const model of TRANSFORMERS_MODELS) {
    assert.equal(getMaxChunkChars(model.id), 4096);
  }
});

test("getMaxChunks fans Transformers.js models out into far fewer chunks", () => {
  for (const model of TRANSFORMERS_MODELS) {
    assert.equal(getMaxChunks(model.id), 4);
  }
  assert.equal(getMaxChunks("Qwen2.5-1.5B-Instruct-q4f16_1-MLC"), 12);
  assert.equal(getMaxChunks("llama3.1:8b"), 12);
});

// A llama.cpp server takes its context window from its own -c launch flag, so the model name cannot imply it. A caller that has asked the server what it is running passes the answer, and it has to beat every name-based guess.
test("getMaxChunkChars prefers a reported context window over the model name", () => {
  // llama3.1 would otherwise be read as a 128k model and capped to 24000.
  assert.equal(getMaxChunkChars("llama3.1:8b"), 87808);
  assert.equal(getMaxChunkChars("llama3.1:8b", 4096), 8192);
});

test("getMaxChunkChars applies a reported window to every model-name shape", () => {
  for (const model of [
    "llama3.1:8b",
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    TRANSFORMERS_MODELS[0].id,
    "Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M",
    "",
  ]) {
    assert.equal(getMaxChunkChars(model, 4096), 8192);
  }
});

test("getMaxChunkChars still caps a large reported window at the practical max", () => {
  assert.equal(getMaxChunkChars("some-model", 32768), 87808);
  assert.equal(getMaxChunkChars("some-model", 1000000), 87808);
});

test("getMaxChunkChars keeps a floor under a tiny reported window", () => {
  assert.equal(getMaxChunkChars("some-model", 1024), 2048);
});

// Everything that does not pass an override has to behave exactly as before.
test("getMaxChunkChars ignores an absent or unusable override", () => {
  for (const override of [undefined, null, 0, -1, NaN, Infinity, "4096", {}]) {
    assert.equal(
      getMaxChunkChars("llama3.1:8b", override),
      getMaxChunkChars("llama3.1:8b"),
      `override ${String(override)} should have been ignored`,
    );
  }
});
