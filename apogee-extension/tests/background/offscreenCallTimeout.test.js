import test from "node:test";
import assert from "node:assert";
import { createExtensionApiMock } from "../helpers/extensionApiMock.js";
import { readSource } from "../helpers/readSource.js";

// --- #469: a wedged model document must not hang the popup ---
//
// The offscreen (model) document is a separate context that can wedge - a
// stuck model, a crashed worker - and every call into it used to await
// indefinitely. A wedged document then hung the popup for good: no error, no
// spinner that ever stops, no way out but reloading the extension.
//
// The calls now carry a bound, in two tiers, because the document answers some
// calls right away and really works on others:
//   - short: stream starts and status probes (the document replies at once)
//   - long: embedding, passage search, one-shot generation (a cold model load)
// Both tiers sit far above what a healthy reply needs, so they only fire when
// the document is stuck.

const { chrome } = createExtensionApiMock({ settings: {} });
globalThis.chrome = chrome;

const { sendOffscreenMessage, MODEL_DOCUMENT_TIMEOUT_MESSAGE } =
  await import("../../lib/util/offscreenCall.js");
const { toUserMessage } = await import("../../lib/util/userError.js");

test("a wedged model document surfaces an error instead of hanging (#469)", async () => {
  chrome.runtime.sendMessage = () => new Promise(() => {});

  await assert.rejects(
    sendOffscreenMessage({ target: "offscreen", action: "status" }, 50),
    (err) => {
      assert.strictEqual(
        err.isUserFacing,
        true,
        "the error carries the user-facing marker",
      );
      assert.strictEqual(err.message, MODEL_DOCUMENT_TIMEOUT_MESSAGE);
      // The message has to survive toUserMessage(), which rewrites anything
      // that is not a UserFacingError into a generic fallback.
      assert.strictEqual(toUserMessage(err), MODEL_DOCUMENT_TIMEOUT_MESSAGE);
      return true;
    },
  );
});

test("a healthy reply is passed through untouched (#469)", async () => {
  chrome.runtime.sendMessage = async () => ({ active: false });

  assert.deepStrictEqual(
    await sendOffscreenMessage(
      { target: "offscreen", action: "has-active-streams" },
      1000,
    ),
    { active: false },
  );
});

test("no call into the model document bypasses the bound (#469)", () => {
  const src = readSource("../../background/service-worker.js", import.meta.url);

  // Any sendMessage whose payload targets the offscreen document must go
  // through sendOffscreenMessage, or it can hang the popup again.
  const unbounded = [];
  let idx = -1;
  while ((idx = src.indexOf("chrome.runtime.sendMessage(", idx + 1)) !== -1) {
    const window = src.slice(idx, idx + 400);
    if (/target:\s*["']offscreen["']/.test(window)) unbounded.push(idx);
  }
  assert.strictEqual(
    unbounded.length,
    0,
    "every call into the model document must go through sendOffscreenMessage",
  );

  const bounded = src.match(/sendOffscreenMessage\(/g) ?? [];
  assert.ok(
    bounded.length >= 11,
    `all offscreen call sites are bounded (found ${bounded.length})`,
  );
  assert.ok(
    src.includes("OFFSCREEN_CALL_TIMEOUT_MS"),
    "the short tier is used for the calls the document answers right away",
  );
  assert.ok(
    src.includes("OFFSCREEN_WORK_CALL_TIMEOUT_MS"),
    "the long tier is used for the calls that do real work",
  );
});
