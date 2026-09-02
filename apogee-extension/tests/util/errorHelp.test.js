import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { errorHelpUrl, ERROR_HELP_URL } from "../../lib/util/errorHelp.js";

const CASES = [
  [
    "Couldn't read this page, try reloading it, or pick a different tab.",
    "reading-the-page",
  ],
  [
    "Nothing to summarize here yet, open a page, email, or video first.",
    "reading-the-page",
  ],
  ["Could not extract enough page content to answer.", "reading-the-page"],
  [
    "Apogee can't read the Chrome Web Store. Browsers block extensions from running on this page, try a regular webpage instead.",
    "reading-the-page",
  ],
  ["This PDF is password-protected.", "pdfs"],
  [
    "Couldn't pull any text out of this PDF, it might be a scanned image.",
    "pdfs",
  ],
  [
    "Could not connect to Ollama at http://localhost:11434. Is it running and listening on that address?",
    "local-ollama",
  ],
  ["Disallowed Ollama host: 192.168.1.20", "local-ollama"],
  ["Failed to load bundled ONNX wasm (404)", "in-browser-models"],
  [
    "Highlight-in-page needs the offscreen document (Chrome/Edge only).",
    "in-browser-models",
  ],
  [
    "Connection to the model was lost before the response finished.",
    "streaming-cancelling-and-background-jobs",
  ],
  [
    "Connection to local model was lost",
    "streaming-cancelling-and-background-jobs",
  ],
  [
    "This response is no longer available (its stream expired). Try summarizing again.",
    "streaming-cancelling-and-background-jobs",
  ],
  ["Error fetching logs: port closed", "settings-cache-and-diagnostics"],
  ["No streamId returned from service worker", "internal"],
  ["Unknown ollama-stream action: pause", "internal"],
  ["Unknown Transformers.js model: made-up", "internal"],
];

test("errorHelpUrl points each message at its section", () => {
  for (const [message, anchor] of CASES) {
    assert.strictEqual(
      errorHelpUrl(message),
      `${ERROR_HELP_URL}#${anchor}`,
      message,
    );
  }
});

test("errorHelpUrl falls back to the top of the file", () => {
  assert.strictEqual(
    errorHelpUrl("WebGPU device lost"),
    `${ERROR_HELP_URL}#in-browser-models`,
  );
  assert.strictEqual(errorHelpUrl(""), ERROR_HELP_URL);
  assert.strictEqual(errorHelpUrl(undefined), ERROR_HELP_URL);
});

// The anchors are GitHub heading slugs, so a renamed heading silently breaks every link. Check them against the file itself.
test("every anchor exists as a heading in ERROR.md", () => {
  const doc = readFileSync(
    new URL("../../../ERROR.md", import.meta.url),
    "utf8",
  );
  const slugs = new Set(
    doc
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) =>
        line
          .slice(3)
          .trim()
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-"),
      ),
  );
  for (const [message, anchor] of CASES) {
    assert.ok(slugs.has(anchor), `${anchor} (from "${message}")`);
  }
});
