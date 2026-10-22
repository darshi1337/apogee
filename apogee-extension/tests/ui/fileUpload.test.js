import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import {
  assertUploadOk,
  assertUploadSizeOk,
  readTextHead,
  UPLOAD_MIME_TYPES,
} from "../../lib/extract/fileLimits.js";
import { toUserMessage } from "../../lib/util/userError.js";

const appCode = readFileSync(
  new URL("../../ui/app.js", import.meta.url),
  "utf8",
);
const appHtml = readFileSync(
  new URL("../../ui/app.html", import.meta.url),
  "utf8",
);
const uploadCode = appCode.slice(
  appCode.indexOf(
    'const fileUploadInput = document.getElementById("fileUploadInput");',
  ),
  appCode.indexOf('sendBtn?.addEventListener("click"'),
);

function uploadHarness({ summarize } = {}) {
  const handlers = {};
  const notices = [];
  const summaries = [];
  const errorClasses = new Set(["hidden"]);
  const error = {
    textContent: "",
    classList: {
      add: (name) => errorClasses.add(name),
      remove: (name) => errorClasses.delete(name),
      contains: (name) => errorClasses.has(name),
      toggle: (name, force) => {
        if (force) errorClasses.add(name);
        else errorClasses.delete(name);
      },
    },
  };
  const input = {
    value: "selected-file",
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  const home = {
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  runInNewContext(uploadCode, {
    document: {
      getElementById: (id) =>
        ({ fileUploadInput: input, fileUploadError: error, homeView: home })[
          id
        ],
    },
    assertUploadOk,
    assertUploadSizeOk,
    readTextHead,
    toUserMessage,
    renderError: (target, message) => {
      target.textContent = message;
    },
    announce: (message) => notices.push(message),
    showOnlyView: () => {},
    summarizeCustomContent:
      summarize ?? (async (name, text) => summaries.push({ name, text })),
    console: { error: () => {} },
  });
  return {
    input,
    notices,
    summaries,
    error,
    upload: async (method, file) => {
      if (method === "change") {
        await handlers.change({ target: { files: [file] } });
      } else {
        let prevented = false;
        await handlers.drop({
          dataTransfer: { files: [file] },
          preventDefault: () => {
            prevented = true;
          },
        });
        assert.equal(prevented, true);
      }
    },
  };
}

test("file picker accept list matches the upload type gate (#472)", () => {
  const { document } = parseHTML(appHtml);
  const accept = document
    .getElementById("fileUploadInput")
    ?.getAttribute("accept");
  const pickerExtensions = (accept || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
  assert.deepEqual(pickerExtensions, Object.keys(UPLOAD_MIME_TYPES).sort());
});

for (const method of ["change", "drop"]) {
  test(`${method} rejects unsupported uploads before reading any bytes (#472)`, async () => {
    for (const [name, type] of [
      ["image.png", "image/png"],
      ["archive.zip", ""],
      ["fake.txt", "image/png"],
      ["fake.pdf", "image/png"],
      ["fake.docx", "image/png"],
    ]) {
      const harness = uploadHarness();
      let reads = 0;
      const read = () => {
        reads += 1;
        return "binary junk";
      };
      await harness.upload(method, {
        name,
        type,
        size: 4,
        text: read,
        arrayBuffer: read,
        stream: read,
      });
      assert.equal(reads, 0, name);
      assert.equal(harness.summaries.length, 0, name);
      assert.equal(harness.error.classList.contains("hidden"), false);
      assert.match(harness.error.textContent, /^Unsupported file type\./);
      assert.match(harness.error.textContent, /PDF, DOCX, TXT, Markdown/);
      assert.equal(harness.input.value, "");
    }
  });

  test(`${method} still summarizes a supported text upload (#472)`, async () => {
    const harness = uploadHarness();
    await harness.upload(method, new File(["junk"], "archive.zip"));
    await harness.upload(method, new File(["  readable text  "], "NOTES.TXT"));
    assert.deepEqual(harness.summaries, [
      { name: "NOTES.TXT", text: "readable text" },
    ]);
    assert.deepEqual(harness.notices, []);
    assert.equal(harness.error.textContent, "");
    assert.equal(harness.error.classList.contains("hidden"), true);
    assert.equal(harness.input.value, "");
  });
}

for (const method of ["change", "drop"]) {
  test(`${method} never shows a raw library error in the file note`, async () => {
    const harness = uploadHarness({
      summarize: async () => {
        throw new Error("EIO: i/o error, read at 0x7f3a (pdfium)");
      },
    });
    await harness.upload(method, new File(["hello"], "notes.txt"));
    assert.equal(harness.error.classList.contains("hidden"), false);
    assert.doesNotMatch(harness.error.textContent, /EIO|0x7f3a|Failed to read/);
    assert.ok(harness.error.textContent.length > 0);
  });
}
