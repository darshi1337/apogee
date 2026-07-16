#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const MODELS = ["qwen3:8b", "mistral:latest", "llama3.1:8b", "gemma3:4b"];

function ollamaInstalled() {
  try {
    execFileSync("ollama", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Parses `ollama list`'s first column into a set of installed model names. */
function listInstalledModels() {
  const output = execFileSync("ollama", ["list"], { encoding: "utf-8" });
  const rows = output.split("\n").slice(1); // skip header row
  return new Set(
    rows
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0]),
  );
}

function modelInstalled(model) {
  try {
    return listInstalledModels().has(model);
  } catch {
    return false;
  }
}

function setup() {
  console.log("Checking Ollama...");
  if (!ollamaInstalled()) {
    console.log("\nOllama is not installed.\nDownload it from https://ollama.com\n");
    return;
  }
  console.log("Ollama found.\n");

  for (const model of MODELS) {
    if (modelInstalled(model)) {
      console.log(`✓ ${model} already installed`);
      continue;
    }
    console.log(`Installing ${model}...`);
    try {
      execFileSync("ollama", ["pull", model], { stdio: "inherit" });
      console.log(`✓ ${model} installed`);
    } catch {
      console.log(`✗ Failed to install ${model}`);
    }
  }
  console.log("\nSetup complete.");
}

function doctor() {
  console.log("Running diagnostics...\n");
  if (!ollamaInstalled()) {
    console.log("✗ Ollama not installed");
    return;
  }
  console.log("✓ Ollama installed");

  try {
    const installed = listInstalledModels();
    for (const model of MODELS) {
      console.log(installed.has(model) ? `✓ ${model}` : `✗ ${model}`);
    }
  } catch {
    console.log("✗ Could not communicate with Ollama");
  }
  console.log("\nDiagnostics complete.");
}

function parsePort(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

async function runServer() {
  const host = process.env.APOGEE_HOST ?? "127.0.0.1";
  let port = parsePort(process.env.APOGEE_PORT ?? "8000");
  if (port === null) {
    console.log("Invalid APOGEE_PORT (must be an integer 1-65535); falling back to 8000.");
    port = 8000;
  }

  console.log(`Starting Apogee on ${host}:${port}`);
  if (port !== 8000 || host !== "127.0.0.1") {
    console.log("  Non-default endpoint: update the extension backend URL to match.");
  }

  const { default: app } = await import("../src/app.js");
  const server = app.listen(port, host);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\nPort ${port} is already in use (another Apogee instance, or a different app).\n` +
          `Free it, or start on another port:  APOGEE_PORT=8001 apogee\n` +
          `If you use a different port, update the extension's backend URL to match.`,
      );
    } else {
      console.error(`\nFailed to start Apogee: ${err.message}`);
    }
    process.exit(1);
  });
}

async function main() {
  const command = process.argv[2]?.toLowerCase();
  if (command === "setup") {
    setup();
    return;
  }
  if (command === "doctor") {
    doctor();
    return;
  }
  await runServer();
}

main().catch((err) => {
  console.error(`\nApogee failed to start: ${err.message}`);
  process.exit(1);
});
