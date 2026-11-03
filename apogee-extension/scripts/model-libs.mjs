import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WEBLLM_MODELS } from "../lib/constants.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MODEL_LIB_CACHE_DIR = resolve(ROOT, ".model-libs-cache");

const MODEL_LIB_URL_PREFIX =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/";

const MODEL_LIB_SHA256 = {
  "Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "155ef7359c859f7d646f4c5adc548d779475da3e3196701c7a9d4b82827559a8",
  "SmolLM2-1.7B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "a1018e99fde3effb6e3c07ca5fbda47ad450c3666e623b52118ea3284f899acf",
  "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "8dbd7e81d39291f2666176b846f36d924a603e9480bac739ee5fc0d22f74b1fd",
  "Phi-3.5-mini-instruct-q4f16_1_cs1k-webgpu.wasm":
    "5f0833c6d162428b671a59ce46386a5d84c724af8ee49651e9af31a3a8d464fd",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertModelVersionMatchesWebLLM() {
  const webllmSrc = readFileSync(
    resolve(ROOT, "node_modules/@mlc-ai/web-llm/lib/index.js"),
    "utf8",
  );
  const match = webllmSrc.match(/const modelVersion = "([^"]+)"/);
  if (!match) {
    throw new Error(
      "Could not find modelVersion in @mlc-ai/web-llm; its internals may " +
        "have changed. Re-derive scripts/model-libs.mjs against it.",
    );
  }
  if (!MODEL_LIB_URL_PREFIX.includes(`/${match[1]}/`)) {
    throw new Error(
      `Bundled model libs are pinned for a different web-llm model version ` +
        `(installed package wants "${match[1]}", pinned URL is ` +
        `${MODEL_LIB_URL_PREFIX}). Update MODEL_LIB_URL_PREFIX and ` +
        `MODEL_LIB_SHA256 for the new version.`,
    );
  }
}

export async function ensureModelLibs() {
  assertModelVersionMatchesWebLLM();
  mkdirSync(MODEL_LIB_CACHE_DIR, { recursive: true });

  const libs = [];
  for (const model of WEBLLM_MODELS) {
    const file = model.lib;
    const expected = MODEL_LIB_SHA256[file];
    if (!file || !expected) {
      throw new Error(
        `No bundled model lib pinned for ${model.id}; add a \`lib\` filename ` +
          `in lib/constants.js and its hash in scripts/model-libs.mjs.`,
      );
    }

    const path = resolve(MODEL_LIB_CACHE_DIR, file);
    if (existsSync(path) && sha256(readFileSync(path)) === expected) {
      libs.push({ file, path });
      continue;
    }

    const url = MODEL_LIB_URL_PREFIX + file;
    console.log(`[model-libs] downloading ${file}...`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== expected) {
      throw new Error(
        `Integrity check FAILED for ${file}: expected ${expected}, got ` +
          `${actual}. Upstream content changed; verify it deliberately ` +
          `before updating the pinned hash.`,
      );
    }
    writeFileSync(path, bytes);
    libs.push({ file, path });
  }
  return libs;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  ensureModelLibs()
    .then((libs) => {
      console.log(`[model-libs] ${libs.length} model libs verified in cache.`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
