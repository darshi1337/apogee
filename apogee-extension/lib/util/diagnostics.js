import { DEFAULT_SETTINGS } from "../constants.js";
import { parsePrivateHosts } from "../storage/pageCache.js";
import { isSensitiveCredentialKey, sanitizeLogMessage } from "./log.js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// customInstructions is free text the user wrote, privateHosts names sites they consider private (a clinic, an employer), and ollamaHost can name a machine on their network. None belongs in something pasted into a public issue, but all matter to a bug report, so report their shape instead of their contents.
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
      if (!LOOPBACK.has(hostname)) return `custom host, port ${port || "none"}`;
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

/**
 * A settings block to sit above the offscreen logs, so a copied report says
 * which configuration produced the behaviour. Values equal to the shipped
 * default are marked, because "everything default except provider" is usually
 * the first thing worth knowing.
 */
export function formatDiagnosticSettings(settings, extra = {}) {
  const lines = ["--- apogee diagnostics ---"];

  for (const [key, fallback] of Object.entries(extra)) {
    if (fallback !== undefined && fallback !== null && fallback !== "") {
      lines.push(`${key}: ${redactExtra(key, fallback)}`);
    }
  }

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = settings?.[key];
    const shown = redact(key, value);
    const isDefault = value === DEFAULT_SETTINGS[key];
    lines.push(`${key}: ${shown}${isDefault ? " (default)" : ""}`);
  }

  lines.push("--- logs ---");
  return lines.join("\n");
}

/**
 * The same report as Markdown, for pasting straight into an issue. Logs go in
 * a collapsed <details> so a long engine trace doesn't bury the description,
 * and inside a fence so backticks in a log line can't break out of it.
 */
export function formatDiagnosticsMarkdown(settings, extra = {}, logs = []) {
  const rows = [];

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== "") {
      const shown = escapeMarkdownTableCell(redactExtra(key, value));
      rows.push(`| ${escapeMarkdownTableCell(key)} | ${shown} |`);
    }
  }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = settings?.[key];
    const shown = escapeMarkdownTableCell(redact(key, value));
    const isDefault = value === DEFAULT_SETTINGS[key];
    rows.push(
      `| ${escapeMarkdownTableCell(key)} | ${shown}${isDefault ? " _(default)_" : ""} |`,
    );
  }

  const body = Array.isArray(logs) ? logs.join("\n") : String(logs || "");
  // A log line containing ``` would end the fence early; widen ours past the longest run it contains.
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
