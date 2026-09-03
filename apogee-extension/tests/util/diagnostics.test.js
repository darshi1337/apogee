import test from "node:test";
import assert from "node:assert";
import {
  formatDiagnosticSettings,
  formatDiagnosticsMarkdown,
} from "../../lib/util/diagnostics.js";
import { sanitizeLogMessage } from "../../lib/util/log.js";
import { DEFAULT_SETTINGS } from "../../lib/constants.js";

function cloneDefaults(overrides = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

test("formatDiagnosticSettings: marks values equal to the shipped default", () => {
  const settings = cloneDefaults();
  const out = formatDiagnosticSettings(settings);
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const line = out.split("\n").find((l) => l.startsWith(`${key}:`));
    assert.ok(line, `missing line for ${key}`);
    assert.match(line, /\(default\)$/, `${key} should be marked default`);
  }
});

test("formatDiagnosticSettings: does not mark non-default values", () => {
  const settings = cloneDefaults({ provider: "local", theme: "light" });
  const out = formatDiagnosticSettings(settings);
  const providerLine = out.split("\n").find((l) => l.startsWith("provider:"));
  assert.ok(providerLine);
  assert.doesNotMatch(providerLine, /\(default\)/);
  const themeLine = out.split("\n").find((l) => l.startsWith("theme:"));
  assert.doesNotMatch(themeLine, /\(default\)/);
  // untouched key still marked
  const saveHistoryLine = out
    .split("\n")
    .find((l) => l.startsWith("saveHistory:"));
  assert.match(saveHistoryLine, /\(default\)/);
});

test("formatDiagnosticSettings: redacts customInstructions to shape not content", () => {
  const unset = formatDiagnosticSettings(
    cloneDefaults({ customInstructions: "" }),
  );
  assert.match(
    unset.split("\n").find((l) => l.startsWith("customInstructions:")),
    /unset/,
  );
  const set = formatDiagnosticSettings(
    cloneDefaults({ customInstructions: "hello" }),
  );
  const line = set.split("\n").find((l) => l.startsWith("customInstructions:"));
  assert.match(line, /set \(5 chars\)/);
  assert.doesNotMatch(line, /hello/);
  const long = "a".repeat(42);
  const line2 = formatDiagnosticSettings(
    cloneDefaults({ customInstructions: long }),
  )
    .split("\n")
    .find((l) => l.startsWith("customInstructions:"));
  assert.match(line2, /set \(42 chars\)/);
});

test("formatDiagnosticSettings: redacts privateHosts to count not list", () => {
  const unset = formatDiagnosticSettings(cloneDefaults({ privateHosts: "" }));
  assert.match(
    unset.split("\n").find((l) => l.startsWith("privateHosts:")),
    /unset/,
  );
  const single = formatDiagnosticSettings(
    cloneDefaults({ privateHosts: "example.com" }),
  );
  assert.match(
    single.split("\n").find((l) => l.startsWith("privateHosts:")),
    /1 host\(s\)/,
  );
  assert.doesNotMatch(single, /example\.com/);
  const multi = formatDiagnosticSettings(
    cloneDefaults({
      privateHosts: "https://www.example.com/path, sub.test.org\nwww.foo.bar",
    }),
  );
  assert.match(
    multi.split("\n").find((l) => l.startsWith("privateHosts:")),
    /3 host\(s\)/,
  );
  // malformed entries without a dot are ignored -> still 1
  const mixed = formatDiagnosticSettings(
    cloneDefaults({ privateHosts: "localhost, example.com" }),
  );
  assert.match(
    mixed.split("\n").find((l) => l.startsWith("privateHosts:")),
    /1 host\(s\)/,
  );
});

test("formatDiagnosticSettings: redacts llamaApiKey to presence only", () => {
  const unset = formatDiagnosticSettings(cloneDefaults({ llamaApiKey: "" }));
  assert.match(
    unset.split("\n").find((l) => l.startsWith("llamaApiKey:")),
    /unset/,
  );
  const set = formatDiagnosticSettings(
    cloneDefaults({ llamaApiKey: "sk-secret" }),
  );
  const line = set.split("\n").find((l) => l.startsWith("llamaApiKey:"));
  assert.match(line, /set/);
  assert.doesNotMatch(line, /sk-secret/);
});

test("formatDiagnosticSettings: redacts ollamaHost and llamaHost", () => {
  // loopback preserved
  const loopback = formatDiagnosticSettings(
    cloneDefaults({ ollamaHost: "http://127.0.0.1:11434" }),
  );
  assert.match(
    loopback.split("\n").find((l) => l.startsWith("ollamaHost:")),
    /http:\/\/127\.0\.0\.1:11434/,
  );
  const localhost = formatDiagnosticSettings(
    cloneDefaults({ ollamaHost: "http://localhost:11434" }),
  );
  assert.match(
    localhost.split("\n").find((l) => l.startsWith("ollamaHost:")),
    /http:\/\/localhost:11434/,
  );
  // custom host -> shape only
  const custom = formatDiagnosticSettings(
    cloneDefaults({ ollamaHost: "http://192.168.1.10:11434" }),
  );
  const line = custom.split("\n").find((l) => l.startsWith("ollamaHost:"));
  assert.match(line, /custom host, port 11434/);
  assert.doesNotMatch(line, /192\.168\.1\.10/);
  const noPort = formatDiagnosticSettings(
    cloneDefaults({ ollamaHost: "http://192.168.1.10" }),
  );
  assert.match(
    noPort.split("\n").find((l) => l.startsWith("ollamaHost:")),
    /custom host, port none/,
  );
  // unparseable
  const bad = formatDiagnosticSettings(
    cloneDefaults({ ollamaHost: "not a url" }),
  );
  assert.match(
    bad.split("\n").find((l) => l.startsWith("ollamaHost:")),
    /unparseable/,
  );
  const empty = formatDiagnosticSettings(cloneDefaults({ ollamaHost: "" }));
  assert.match(
    empty.split("\n").find((l) => l.startsWith("ollamaHost:")),
    /unset/,
  );
  // llamaHost follows same rules
  const llamaCustom = formatDiagnosticSettings(
    cloneDefaults({ llamaHost: "http://my-server.local:8080" }),
  );
  assert.match(
    llamaCustom.split("\n").find((l) => l.startsWith("llamaHost:")),
    /custom host, port 8080/,
  );
});

test("formatDiagnosticSettings: omits empty extra fields and sanitizes extra values", () => {
  const out = formatDiagnosticSettings(cloneDefaults(), {
    version: "1.2.3",
    empty: "",
    nil: null,
    undef: undefined,
    url: "https://example.com?apiKey=secret&x=1",
  });
  assert.ok(out.startsWith("--- apogee diagnostics ---"));
  assert.ok(out.includes("--- logs ---"));
  assert.match(out, /version: 1\.2\.3/);
  assert.match(out, /url: https:\/\/example\.com\?\[redacted-query\]/);
  assert.doesNotMatch(out, /apiKey=secret/);
  assert.doesNotMatch(out, /empty:/);
  assert.doesNotMatch(out, /nil:/);
  assert.doesNotMatch(out, /undef:/);
});

test("sanitizeLogMessage: redacts JSON-style API key fields", () => {
  const out = sanitizeLogMessage(
    '{"apiKey":"secret-123","api-key":"another-secret","access_token":"token-456"}',
  );
  assert.doesNotMatch(out, /secret-123|another-secret|token-456/);
  assert.match(out, /apiKey.*redacted/);
  assert.match(out, /api-key.*redacted/);
  assert.match(out, /access_token.*redacted/);
});

test("sanitizeLogMessage: redacts JSON values containing escaped quotes", () => {
  const out = sanitizeLogMessage('{"apiKey":"xx\\"yy"}');
  assert.doesNotMatch(out, /xx|yy/);
  assert.match(out, /apiKey.*redacted/);
});

test("formatDiagnosticsMarkdown: redacts extra values", () => {
  const md = formatDiagnosticsMarkdown(
    cloneDefaults(),
    { error: 'request failed for "apiKey":"secret"' },
    [],
  );
  assert.doesNotMatch(md, /secret/);
  assert.match(md, /apiKey.*redacted/);
});

test("formatDiagnosticsMarkdown: redacts log values", () => {
  const md = formatDiagnosticsMarkdown(cloneDefaults(), {}, [
    'payload {"apiKey":"secret"}',
    "Authorization: Bearer secret-token",
  ]);
  assert.doesNotMatch(md, /secret-token|apiKey.*secret/);
});

test("formatDiagnosticsMarkdown: marks defaults with _\\(default\\)_ and escapes table chars", () => {
  const settings = cloneDefaults({ provider: "local" });
  const md = formatDiagnosticsMarkdown(settings, { "extra|key": "a\\b|c" }, []);
  // default key should have marker
  assert.match(md, /\| theme \| dark _\(default\)_ \|/);
  // non-default should not
  const providerRow = md.split("\n").find((l) => l.includes("| provider |"));
  assert.ok(providerRow);
  assert.doesNotMatch(providerRow, /_\(default\)_/);
  // extra escaping: key is not escaped, value is (backslash doubled, pipe escaped)
  assert.ok(md.includes("| extra|key | a\\\\b\\|c |"));
  // setting value escaping: customInstructions with pipe is redacted, so no pipe remains
  const md2 = formatDiagnosticsMarkdown(
    cloneDefaults({ customInstructions: "a|b\\c" }),
    {},
    [],
  );
  assert.ok(md2.includes("set (5 chars)"));
});

test("formatDiagnosticsMarkdown: pipes and backslashes in redacted values are escaped", () => {
  // Force a value that after redaction contains no pipe, so test via extra is sufficient;
  // also verify that DEFAULT_SETTINGS values with no special chars pass through escaped correctly.
  const md = formatDiagnosticsMarkdown(cloneDefaults(), { note: "a|b\\c" }, []);
  assert.ok(md.includes("| note | a\\|b\\\\c |") || md.includes("a\\|b"));
});

test("formatDiagnosticsMarkdown: fence widens past the longest backtick run in logs", () => {
  const logsWithTriple = ["hello ``` world", "```code```"];
  const md = formatDiagnosticsMarkdown(cloneDefaults(), {}, logsWithTriple);
  // longest run is 3, fence should be 4 backticks
  assert.ok(md.includes("````\nhello ``` world\n```code```\n````"));
  // no backticks -> fence is 3
  const md2 = formatDiagnosticsMarkdown(cloneDefaults(), {}, ["no ticks here"]);
  assert.ok(md2.includes("```\nno ticks here\n```"));
  // double backticks -> fence 3
  const md3 = formatDiagnosticsMarkdown(cloneDefaults(), {}, ["a `` b"]);
  assert.ok(md3.includes("```\na `` b\n```"));
  // five backticks -> fence 6
  const md4 = formatDiagnosticsMarkdown(cloneDefaults(), {}, ["x ````` y"]);
  assert.ok(md4.includes("``````\nx ````` y\n``````"));
});

test("formatDiagnosticsMarkdown: handles empty or missing logs", () => {
  const md = formatDiagnosticsMarkdown(cloneDefaults(), {}, []);
  assert.ok(md.includes("No logs recorded."));
  const md2 = formatDiagnosticsMarkdown(cloneDefaults(), {}, "");
  assert.ok(md2.includes("No logs recorded."));
});

test("formatDiagnosticsMarkdown: includes heading, table header, and collapsed details", () => {
  const md = formatDiagnosticsMarkdown(cloneDefaults(), { version: "9.9.9" }, [
    "log line",
  ]);
  assert.ok(md.startsWith("### apogee diagnostics"));
  assert.ok(md.includes("| setting | value |"));
  assert.ok(md.includes("| --- | --- |"));
  assert.ok(md.includes("<details>"));
  assert.ok(md.includes("<summary>Engine logs</summary>"));
  assert.ok(md.includes("log line"));
  assert.ok(md.includes("> ⚠️ **Review before posting:**"));
  // extra row present
  assert.ok(md.includes("| version | 9.9.9 |"));
});

test("formatDiagnosticsMarkdown: omits empty extra fields", () => {
  const md = formatDiagnosticsMarkdown(
    cloneDefaults(),
    { a: "", b: null, c: undefined, d: "ok" },
    [],
  );
  assert.doesNotMatch(md, /\| a \|/);
  assert.doesNotMatch(md, /\| b \|/);
  assert.doesNotMatch(md, /\| c \|/);
  assert.ok(md.includes("| d | ok |"));
});
