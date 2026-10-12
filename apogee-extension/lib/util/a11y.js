// Helpers for modal dialogs (#315). Kept free of DOM globals beyond the
// passed-in nodes, so node tests run without a browser.

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isRendered(element) {
  // Hidden attribute only: rects are zero in test DOMs and for display:none
  // alike, so they cannot tell the two apart.
  if (!element || element.hidden) return false;
  return !element.closest?.("[hidden]");
}

// Tab order in DOM order; the caller owns focus movement.
export function getTrapTargets(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isRendered);
}

// Next focus target for Tab/Shift+Tab, or null when focus stays put.
export function nextTrapTarget(targets, current, shiftKey) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const index = targets.indexOf(current);
  if (index === -1) return shiftKey ? targets[targets.length - 1] : targets[0];
  if (!shiftKey && index === targets.length - 1) return targets[0];
  if (shiftKey && index === 0) return targets[targets.length - 1];
  return null;
}

// Wire a Tab keydown to the trap; true when handled.
export function handleTrapTabKey(event, root, current) {
  if (!event || event.key !== "Tab") return false;
  const targets = getTrapTargets(root);
  const next = nextTrapTarget(targets, current, event.shiftKey);
  if (!next) {
    // No wrap point: hold focus when the dialog is empty, else let the
    // browser move it.
    if (targets.length === 0) event.preventDefault();
    return targets.length === 0;
  }
  event.preventDefault();
  next.focus();
  return true;
}

// Trailing-edge announcer: rapid calls collapse to the last message,
// and repeats of the live-region text are dropped to avoid chatter.
// Tests inject `write` as a recorder.
export function createAnnouncer(write, { delayMs = 300 } = {}) {
  let timer = null;
  let pending = null;
  let delivered = Symbol("none");

  function deliver() {
    timer = null;
    const message = pending;
    pending = null;
    if (message === delivered) return;
    delivered = message;
    write(message);
  }

  function announce(message) {
    if (timer) clearTimeout(timer);
    else if (message === delivered) return;
    pending = message;
    timer = setTimeout(deliver, delayMs);
  }

  announce.flush = () => {
    if (timer) {
      clearTimeout(timer);
      deliver();
    }
  };
  announce.pending = () => pending;

  return announce;
}
