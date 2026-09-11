import test from "node:test";
import assert from "node:assert";

import { formatNotificationMessage } from "../../lib/util/userError.js";

test("short error message under 120 chars keeps standard suffix untouched", () => {
  const message = "An unexpected error occurred. Try summarizing again.";
  const formatted = formatNotificationMessage(message);
  assert.strictEqual(
    formatted,
    "An unexpected error occurred. Try summarizing again. Click to see what this means.",
  );
  assert.ok(formatted.length <= 120);
});

test("long offscreen download-interrupted message is truncated with short suffix", () => {
  const rawMessage =
    "The model download keeps getting interrupted (the download server stalled or the connection dropped). Progress so far is saved, so trying again later will resume where it left off.";
  const formatted = formatNotificationMessage(rawMessage);
  assert.strictEqual(
    formatted,
    "The model download keeps getting interrupted (the download server stalled or the connection... Open Apogee for details.",
  );
  assert.ok(formatted.length <= 120);
});

test("DOCX file too large message remains untouched under threshold", () => {
  const rawMessage =
    "DOCX file is too large (25.4 MB). Apogee supports DOCX files up to 20MB.";
  const formatted = formatNotificationMessage(rawMessage);
  assert.strictEqual(
    formatted,
    "DOCX file is too large (25.4 MB). Apogee supports DOCX files up to 20MB. Click to see what this means.",
  );
  assert.ok(formatted.length <= 120);
});

test("PDF fallback error message remains untouched under threshold", () => {
  const rawMessage = "Couldn't process this PDF document.";
  const formatted = formatNotificationMessage(rawMessage);
  assert.strictEqual(
    formatted,
    "Couldn't process this PDF document. Click to see what this means.",
  );
  assert.ok(formatted.length <= 120);
});

test("shortest error messages ('Could not download PDF') remain untouched", () => {
  const msg1 = "Could not download PDF.";
  const msg2 = "This DOCX file is corrupt.";
  const formatted1 = formatNotificationMessage(msg1);
  const formatted2 = formatNotificationMessage(msg2);
  assert.strictEqual(
    formatted1,
    "Could not download PDF. Click to see what this means.",
  );
  assert.strictEqual(
    formatted2,
    "This DOCX file is corrupt. Click to see what this means.",
  );
  assert.ok(formatted1.length <= 120);
  assert.ok(formatted2.length <= 120);
});

test("boundary condition: message exactly 120 chars total remains untouched", () => {
  // Suffix is 30 chars (" Click to see what this means.")
  // 90 char message + 30 char suffix = 120 chars total
  const rawMessage = "x".repeat(90);
  const formatted = formatNotificationMessage(rawMessage);
  assert.strictEqual(
    formatted,
    "x".repeat(90) + " Click to see what this means.",
  );
  assert.strictEqual(formatted.length, 120);
});

test("boundary condition: message 121 chars total gets truncated", () => {
  // 91 char message + 30 char suffix = 121 chars total
  const rawMessage = "x".repeat(91);
  const formatted = formatNotificationMessage(rawMessage);
  assert.strictEqual(
    formatted,
    "x".repeat(91) + "... Open Apogee for details.",
  );
  assert.ok(formatted.length <= 120);
});

test("long message truncates raw to cap with exact 120 char total", () => {
  const rawMessage = "y".repeat(200);
  const formatted = formatNotificationMessage(rawMessage);
  assert.strictEqual(
    formatted,
    "y".repeat(92) + "... Open Apogee for details.",
  );
  assert.strictEqual(formatted.length, 120);
});

test("success path with empty suffix keeps short message untouched", () => {
  const formatted = formatNotificationMessage("Click to view it.", "");
  assert.strictEqual(formatted, "Click to view it.");
});

test("success path with empty suffix truncates long title", () => {
  const rawMessage = `"${"t".repeat(150)}" is ready to view.`;
  const formatted = formatNotificationMessage(rawMessage, "");
  assert.ok(formatted.length <= 120);
  assert.ok(formatted.endsWith("... Open Apogee for details."));
});
