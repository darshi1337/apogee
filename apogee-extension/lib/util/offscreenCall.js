// Calls into the offscreen (model) document, with a bound.
//
// #469: the offscreen document is a separate context that can wedge - a stuck
// model, a crashed worker - and every call into it used to await
// indefinitely. A wedged document then hung the popup for good: no error, no
// spinner that ever stops, no way out but reloading the extension.
//
// The bound turns that into a user-facing error. The caller picks the bound:
// the calls the document answers right away (stream starts, status probes) get
// a short one, the calls that do real work (embedding, passage search,
// one-shot generation, all of which can need a cold model load) get a much
// longer one.
import { withTimeout } from "./withTimeout.js";
import { UserFacingError } from "./userError.js";

export const MODEL_DOCUMENT_TIMEOUT_MESSAGE =
  "The model document did not respond in time. Try reloading the extension and retrying.";

/**
 * Send one message to the offscreen document and wait at most `timeoutMs`.
 *
 * @param {object} message the chrome.runtime message payload
 * @param {number} timeoutMs how long the document may take to answer
 * @returns {Promise<any>} whatever the document replied
 */
export async function sendOffscreenMessage(message, timeoutMs) {
  return withTimeout(chrome.runtime.sendMessage(message), timeoutMs, {
    onTimeout: () => {
      throw new UserFacingError(MODEL_DOCUMENT_TIMEOUT_MESSAGE);
    },
  });
}
