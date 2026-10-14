import { DEFAULT_SETTINGS } from "../constants.js";
import { parsePrivateHosts } from "../storage/pageCache.js";
import { isSensitiveCredentialKey, sanitizeLogMessage } from "./log.js";
import { ALLOWED_OLLAMA_HOSTS } from "./ollamaHost.js";

// Loopback display shares the validator set in ollamaHost.js.

// Free-text settings shape bug reports but must not leak into pasted
// issues, so report their shape instead of their contents.
function redact(key, value) {
  if (key === "customInstructions") {
    const text = String(value || "");
    return text ? `set (${text.length} chars)` : "unset";
  }
  if (key === "privateHosts") {
    const entries = parsePrivateHosts(value);
    return entries.length ? `${entries.length} host(s)` : "unset";
  }
  if (key === "llamaApiKey") {
    return value ? "set" : "unset";
  }
  if (isSensitiveCredentialKey(key)) {
    return value ? "[redacted]" : "unset";
  }
  if (key === "ollamaHost" || key === "llamaHost") {
    const host = String(value || "");
    try {
      const { hostname, port, protocol } = new URL(host);
      if (!ALLOWED_OLLAMA_HOSTS.has(hostname))
        return `custom host, port ${port || "none"}`;
      return `${protocol}//${hostname}${port ? ":" + port : ""}`;
    } catch {
      return host ? "unparseable" : "unset";
    }
  }
  return value;
}

function escapeMarkdownTableCell(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function redactExtra(key, value) {
  return sanitizeLogMessage(redact(key, value));
}

// Redacted effective config (#416): every known setting with secret
// values hidden, for the Settings view and the diagnostic reports alike.
// Entries carry the display value plus whether it equals the default.
export function getRedactedSettings(settings) {
  return Object.keys(DEFAULT_SETTINGS).map((key) => {
    const value = settings?.[key];
    return {
      key,
      value: redact(key, value),
      isDefault: value === DEFAULT_SETTINGS[key],
    };
  });
}

// Shared extra-fields pass for both report shapes: skip empties, redact
// the rest. Escaping stays at the format site (Markdown only).
function redactedExtraEntries(extra) {
  const entries = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === "") continue;
    entries.push([key, redactExtra(key, value)]);
  }
  return entries;
}

// Settings block for the top of a report, so a copy says which config
// produced the behaviour. Defaults are marked.
export function formatDiagnosticSettings(settings, extra = {}) {
  const lines = ["--- apogee diagnostics ---"];

  for (const [key, shown] of redactedExtraEntries(extra)) {
    lines.push(`${key}: ${shown}`);
  }

  for (const { key, value, isDefault } of getRedactedSettings(settings)) {
    lines.push(`${key}: ${value}${isDefault ? " (default)" : ""}`);
  }

  lines.push("--- logs ---");
  return lines.join("\n");
}

// Same report as Markdown for pasting into an issue. Logs sit collapsed
// in a fence sized past any backticks they contain.
export function formatDiagnosticsMarkdown(settings, extra = {}, logs = []) {
  const rows = [];

  for (const [key, shown] of redactedExtraEntries(extra)) {
    const cell = escapeMarkdownTableCell(shown);
    rows.push(`| ${escapeMarkdownTableCell(key)} | ${cell} |`);
  }
  for (const { key, value, isDefault } of getRedactedSettings(settings)) {
    const shown = escapeMarkdownTableCell(value);
    rows.push(
      `| ${escapeMarkdownTableCell(key)} | ${shown}${isDefault ? " _(default)_" : ""} |`,
    );
  }

  const body = Array.isArray(logs) ? logs.join("\n") : String(logs || "");
  // Widen the fence past the longest backtick run so logs cannot break out.
  const longest = Math.max(
    2,
    ...(body.match(/`+/g) || []).map((r) => r.length),
  );
  const fence = "`".repeat(longest + 1);

  return [
    "### apogee diagnostics",
    "",
    "> ⚠️ **Review before posting:** Engine logs may contain details about the",
    "> page that triggered the bug. Check what you are sharing.",
    "",
    "| setting | value |",
    "| --- | --- |",
    ...rows,
    "",
    "<details>",
    "<summary>Engine logs</summary>",
    "",
    fence,
    body || "No logs recorded.",
    fence,
    "",
    "</details>",
    "",
  ].join("\n");
}
