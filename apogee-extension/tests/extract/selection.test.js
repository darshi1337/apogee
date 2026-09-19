import test from "node:test";
import assert from "node:assert";
import {
  MIN_SELECTION_LENGTH,
  SELECTION_CAPTURE_TIMEOUT_MS,
  normalizeSelectedText,
  isSummarizableSelection,
  activateSelectionCapture,
} from "../../lib/extract/selection.js";

test("selection extraction normalization collapses whitespace", () => {
  assert.strictEqual(
    normalizeSelectedText("  one\n two\t three  "),
    "one two three",
  );
});

test("empty and short selections are not summarizable", () => {
  assert.strictEqual(isSummarizableSelection(""), false);
  assert.strictEqual(
    isSummarizableSelection("x".repeat(MIN_SELECTION_LENGTH - 1)),
    false,
  );
  assert.strictEqual(
    isSummarizableSelection("x".repeat(MIN_SELECTION_LENGTH)),
    true,
  );
});

test("activateSelectionCapture handles missing tab or chrome gracefully", async () => {
  assert.strictEqual(await activateSelectionCapture(null), false);
  assert.strictEqual(await activateSelectionCapture({}), false);
  assert.strictEqual(await activateSelectionCapture({ id: 0 }), false);
});

test("activateSelectionCapture injects script with timeout parameter", async () => {
  let executed = null;
  globalThis.chrome = {
    scripting: {
      executeScript: async (options) => {
        executed = options;
      },
    },
  };

  try {
    const success = await activateSelectionCapture({ id: 123 }, 30000);
    assert.strictEqual(success, true);
    assert.strictEqual(executed.target.tabId, 123);
    assert.deepStrictEqual(executed.args, [MIN_SELECTION_LENGTH, 30000]);
  } finally {
    delete globalThis.chrome;
  }
});

test("activateSelectionCapture defaults to SELECTION_CAPTURE_TIMEOUT_MS", async () => {
  let executed = null;
  globalThis.chrome = {
    scripting: {
      executeScript: async (options) => {
        executed = options;
      },
    },
  };

  try {
    const success = await activateSelectionCapture({ id: 123 });
    assert.strictEqual(success, true);
    assert.deepStrictEqual(executed.args, [
      MIN_SELECTION_LENGTH,
      SELECTION_CAPTURE_TIMEOUT_MS,
    ]);
  } finally {
    delete globalThis.chrome;
  }
});

test("injected capture function auto-tears-down on timeout and clears guard", async () => {
  let injectedOptions = null;
  globalThis.chrome = {
    scripting: {
      executeScript: async (options) => {
        injectedOptions = options;
      },
    },
  };

  await activateSelectionCapture({ id: 1 }, 10);
  delete globalThis.chrome;

  const docListeners = {};
  const winListeners = {};
  const fakeDoc = {
    addEventListener: (type, fn) => {
      docListeners[type] = fn;
    },
    removeEventListener: (type) => {
      delete docListeners[type];
    },
  };
  const fakeWin = {
    addEventListener: (type, fn) => {
      winListeners[type] = fn;
    },
    removeEventListener: (type) => {
      delete winListeners[type];
    },
  };

  const origWindow = globalThis.window;
  const origDocument = globalThis.document;
  globalThis.window = fakeWin;
  globalThis.document = fakeDoc;

  try {
    injectedOptions.func(MIN_SELECTION_LENGTH, 10);
    assert.strictEqual(fakeWin.__apogeeSelectionCapture, true);
    assert.strictEqual(
      typeof fakeWin.__apogeeSelectionCaptureTeardown,
      "function",
    );
    assert.ok(docListeners.selectionchange);
    assert.ok(winListeners.mouseup);

    // Wait for timeout to fire
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(fakeWin.__apogeeSelectionCapture, undefined);
    assert.strictEqual(fakeWin.__apogeeSelectionCaptureTeardown, undefined);
    assert.strictEqual(docListeners.selectionchange, undefined);
    assert.strictEqual(winListeners.mouseup, undefined);
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
  }
});

test("injected capture function sends message on valid selection and tears down", async () => {
  let injectedOptions = null;
  const sent = [];
  globalThis.chrome = {
    scripting: {
      executeScript: async (options) => {
        injectedOptions = options;
      },
    },
  };

  await activateSelectionCapture({ id: 1 });

  globalThis.chrome = {
    runtime: {
      sendMessage: (msg) => {
        sent.push(msg);
      },
    },
  };

  const docListeners = {};
  const winListeners = {};
  let selectionText = "short";
  const fakeDoc = {
    addEventListener: (type, fn) => {
      docListeners[type] = fn;
    },
    removeEventListener: (type) => {
      delete docListeners[type];
    },
  };
  const fakeWin = {
    addEventListener: (type, fn) => {
      winListeners[type] = fn;
    },
    removeEventListener: (type) => {
      delete winListeners[type];
    },
    getSelection: () => ({
      toString: () => selectionText,
    }),
  };

  const origWindow = globalThis.window;
  const origDocument = globalThis.document;
  globalThis.window = fakeWin;
  globalThis.document = fakeDoc;

  try {
    injectedOptions.func(MIN_SELECTION_LENGTH, 60000);

    // Short selection sends nothing and keeps capture armed
    docListeners.selectionchange();
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(fakeWin.__apogeeSelectionCapture, true);

    // Long selection sends one message and tears down
    selectionText = "x".repeat(MIN_SELECTION_LENGTH + 5);
    winListeners.mouseup();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].target, "service-worker");
    assert.strictEqual(sent[0].action, "summarize-selection");
    assert.strictEqual(
      sent[0].payload.selectionText,
      "x".repeat(MIN_SELECTION_LENGTH + 5),
    );
    assert.strictEqual(fakeWin.__apogeeSelectionCapture, undefined);
    assert.strictEqual(docListeners.selectionchange, undefined);
    assert.strictEqual(winListeners.mouseup, undefined);
  } finally {
    if (typeof fakeWin.__apogeeSelectionCaptureTeardown === "function") {
      fakeWin.__apogeeSelectionCaptureTeardown();
    }
    delete globalThis.chrome;
    globalThis.window = origWindow;
    globalThis.document = origDocument;
  }
});

test("injected capture function allows re-entry and resets prior capture", async () => {
  let injectedOptions = null;
  globalThis.chrome = {
    scripting: {
      executeScript: async (options) => {
        injectedOptions = options;
      },
    },
  };

  await activateSelectionCapture({ id: 1 });
  delete globalThis.chrome;

  let docRemoveCount = 0;
  let winRemoveCount = 0;
  const fakeDoc = {
    addEventListener: () => {},
    removeEventListener: () => {
      docRemoveCount++;
    },
  };
  const fakeWin = {
    addEventListener: () => {},
    removeEventListener: () => {
      winRemoveCount++;
    },
  };

  const origWindow = globalThis.window;
  const origDocument = globalThis.document;
  globalThis.window = fakeWin;
  globalThis.document = fakeDoc;

  try {
    // First activation
    injectedOptions.func(MIN_SELECTION_LENGTH, 100);
    assert.strictEqual(fakeWin.__apogeeSelectionCapture, true);
    const firstTeardown = fakeWin.__apogeeSelectionCaptureTeardown;

    // Second activation without selection (re-entry)
    injectedOptions.func(MIN_SELECTION_LENGTH, 100);
    assert.strictEqual(fakeWin.__apogeeSelectionCapture, true);
    assert.notStrictEqual(
      fakeWin.__apogeeSelectionCaptureTeardown,
      firstTeardown,
    );
    assert.ok(
      docRemoveCount >= 1,
      "First doc listener should have been removed on re-entry",
    );
    assert.ok(
      winRemoveCount >= 1,
      "First win listener should have been removed on re-entry",
    );

    // Clean up
    fakeWin.__apogeeSelectionCaptureTeardown();
  } finally {
    if (typeof fakeWin.__apogeeSelectionCaptureTeardown === "function") {
      fakeWin.__apogeeSelectionCaptureTeardown();
    }
    globalThis.window = origWindow;
    globalThis.document = origDocument;
  }
});
