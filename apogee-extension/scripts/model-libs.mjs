import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WEBLLM_MODELS } from "../lib/constants.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MODEL_LIB_CACHE_DIR = resolve(ROOT, ".model-libs-cache");

const MODEL_LIB_URL_PREFIX =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/base/";

const MODEL_LIB_SHA256 = {
  "Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "436462adad407e0914d2350fd452a5a3d983e0031d77c940c43ea351c8cd3000",
  "SmolLM2-1.7B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "60ba2472d38d66fa4d8ed02821c1fbd7c448ddcde8c948571ace6ac6d996cba4",
  "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm":
    "4aa19a3b4531cd223931adf4523ff45f6822503820a7d394b57f6864ae606024",
  "Phi-3.5-mini-instruct-q4f16_1_cs1k-webgpu.wasm":
    "1aacd70715c4bf67ce932b30ec9b9be65f9d5d65a3f750b37066f44097c26a49",
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
