import test from "node:test";
import assert from "node:assert";

import {
  allowLocalPdfAccess,
  getCorsOriginRegex,
  getOllamaHealthTimeout,
  getOllamaHost,
} from "../src/config.js";

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

test("getOllamaHealthTimeout falls back to the default for an empty (but set) env var", () => {
  withEnv("APOGEE_OLLAMA_HEALTH_TIMEOUT", "", () => {
    assert.strictEqual(getOllamaHealthTimeout(), 3.0);
  });
});

test("getOllamaHealthTimeout parses a numeric override", () => {
  withEnv("APOGEE_OLLAMA_HEALTH_TIMEOUT", "10", () => {
    assert.strictEqual(getOllamaHealthTimeout(), 10);
  });
});

test("getOllamaHealthTimeout falls back to the default for a non-numeric override", () => {
  withEnv("APOGEE_OLLAMA_HEALTH_TIMEOUT", "not-a-number", () => {
    assert.strictEqual(getOllamaHealthTimeout(), 3.0);
  });
});

test("allowLocalPdfAccess recognizes case-insensitive falsy values", () => {
  for (const falsy of ["0", "false", "False", "FALSE", "no", "NO", "off", "Off"]) {
    withEnv("APOGEE_ALLOW_LOCAL_PDFS", falsy, () => {
      assert.strictEqual(allowLocalPdfAccess(), false, `expected ${falsy} to disable local PDFs`);
    });
  }
});

test("allowLocalPdfAccess defaults to true when unset", () => {
  withEnv("APOGEE_ALLOW_LOCAL_PDFS", undefined, () => {
    assert.strictEqual(allowLocalPdfAccess(), true);
  });
});

test("getCorsOriginRegex auto-anchors an unanchored custom override", () => {
  withEnv("APOGEE_CORS_ORIGIN_REGEX", "https://example\\.com", () => {
    const pattern = new RegExp(getCorsOriginRegex());
    assert.strictEqual(pattern.test("https://example.com"), true);
    // Without anchoring this would substring-match and incorrectly allow
    // an attacker-controlled origin that merely contains the pattern.
    assert.strictEqual(pattern.test("https://example.com.attacker.net"), false);
    assert.strictEqual(pattern.test("https://evil.com/https://example.com"), false);
  });
});

test("getCorsOriginRegex leaves an already-anchored custom override untouched", () => {
  withEnv("APOGEE_CORS_ORIGIN_REGEX", "^https://example\\.com$", () => {
    assert.strictEqual(getCorsOriginRegex(), "^https://example\\.com$");
  });
});

test("getOllamaHost passes through a set value and returns undefined when unset/blank", () => {
  withEnv("OLLAMA_HOST", "http://10.0.0.5:11434", () => {
    assert.strictEqual(getOllamaHost(), "http://10.0.0.5:11434");
  });
  withEnv("OLLAMA_HOST", "", () => {
    assert.strictEqual(getOllamaHost(), undefined);
  });
  withEnv("OLLAMA_HOST", undefined, () => {
    assert.strictEqual(getOllamaHost(), undefined);
  });
});
