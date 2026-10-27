import fs from "node:fs";

// Shared source-reading helper for wiring-guard tests (in the style of
// offscreenKeepAlive.test.js): tests assert on the shipped source to lock
// cross-runtime call sites together.
export function readSource(relPath, baseUrl) {
  return fs.readFileSync(new URL(relPath, baseUrl), "utf-8");
}

// Extract a function body between its opening brace and the next marker, so
// wiring tests can assert on one function without matching the whole file.
export function functionBody(source, name, nextMarker) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `(?:async )?function ${escape(name)}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}\\n\\n${escape(nextMarker)}`,
    ),
  );
  if (!match) throw new Error(`Function ${name} not found in source.`);
  return match[1];
}
