import test from "node:test";
import assert from "node:assert";
import {
  formatDiagnosticSettings,
  formatDiagnosticsMarkdown,
} from "../../lib/util/diagnostics.js";
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
  const llamaCustom = formatDiagnosticSettings(
    cloneDefaults({ llamaHost: "http://my-server.local:8080" }),
  );
  assert.match(
    llamaCustom.split("\n").find((l) => l.startsWith("llamaHost:")),
    /custom host, port 8080/,
  );
});

test("formatDiagnosticSettings: omits empty extra fields and wraps with banners", () => {
  const out = formatDiagnosticSettings(cloneDefaults(), {
    version: "1.2.3",
    empty: "",
    nil: null,
    undef: undefined,
    url: "https://example.com",
  });
  assert.ok(out.startsWith("--- apogee diagnostics ---"));
  assert.ok(out.includes("--- logs ---"));
  assert.match(out, /version: 1\.2\.3/);
  assert.match(out, /url: https:\/\/example\.com/);
  assert.doesNotMatch(out, /empty:/);
  assert.doesNotMatch(out, /nil:/);
  assert.doesNotMatch(out, /undef:/);
});

test("formatDiagnosticsMarkdown: marks defaults with _\\(default\\)_ and escapes table chars", () => {
  const settings = cloneDefaults({ provider: "local" });
  const md = formatDiagnosticsMarkdown(
    settings,
    { "extra|note": "a\\b|c" },
    [],
  );
  assert.match(md, /\| theme \| dark _\(default\)_ \|/);
  const providerRow = md.split("\n").find((l) => l.includes("| provider |"));
  assert.ok(providerRow);
  assert.doesNotMatch(providerRow, /_\(default\)_/);
  assert.ok(md.includes("| extra\\|note | a\\\\b\\|c |"));
  const md2 = formatDiagnosticsMarkdown(
    cloneDefaults({ customInstructions: "a|b\\c" }),
    {},
    [],
  );
  assert.ok(md2.includes("set (5 chars)"));
});

test("formatDiagnosticsMarkdown: pipes and backslashes in redacted values are escaped", () => {
  const md = formatDiagnosticsMarkdown(cloneDefaults(), { note: "a|b\\c" }, []);
  assert.ok(md.includes("| note | a\\|b\\\\c |") || md.includes("a\\|b"));
});

test("formatDiagnosticsMarkdown: redacts sensitive extra values", () => {
  const md = formatDiagnosticsMarkdown(cloneDefaults(), {
    apiKey: "sk-live-secret",
    auth: "Bearer super-secret-token",
    apiKeyJson: '{"apiKey":"json-secret"}',
    apiKeyYaml: "api-key: yaml-secret",
    password: "hunter2",
    author: "John Doe",
    url: "https://user:password@example.com/path?token=secret",
  });

  assert.doesNotMatch(md, /sk-live-secret/);
  assert.doesNotMatch(md, /super-secret-token/);
  assert.doesNotMatch(md, /json-secret/);
  assert.doesNotMatch(md, /yaml-secret/);
  assert.doesNotMatch(md, /hunter2/);
  assert.doesNotMatch(md, /password@example\.com/);
  assert.doesNotMatch(md, /token=secret/);
  // non-credential keys pass through untouched
  assert.ok(md.includes("John Doe"));
});

test("formatDiagnosticsMarkdown: fence widens past the longest backtick run in logs", () => {
  const logsWithTriple = ["hello ``` world", "```code```"];
  const md = formatDiagnosticsMarkdown(cloneDefaults(), {}, logsWithTriple);
  assert.ok(md.includes("````\nhello ``` world\n```code```\n````"));
  const md2 = formatDiagnosticsMarkdown(cloneDefaults(), {}, ["no ticks here"]);
  assert.ok(md2.includes("```\nno ticks here\n```"));
  const md3 = formatDiagnosticsMarkdown(cloneDefaults(), {}, ["a `` b"]);
  assert.ok(md3.includes("```\na `` b\n```"));
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
