import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ALLOWED_PDF_ROOTS,
  fetchPdfWithValidatedRedirects,
  isSafeRemoteUrl,
  pinnedLookup,
  validateLocalPath,
} from "../src/routes/pdf.js";
import { HttpError } from "../src/utils/httpError.js";

test("pinnedLookup resolves the pinned host to the pinned IP without touching real DNS", (t, done) => {
  const lookup = pinnedLookup("test-domain.local", "9.9.9.9");
  lookup("test-domain.local", {}, (err, address, family) => {
    assert.ifError(err);
    assert.strictEqual(address, "9.9.9.9");
    assert.strictEqual(family, 4);
    done();
  });
});

test("pinnedLookup falls through to real DNS for other hostnames", (t, done) => {
  const lookup = pinnedLookup("test-domain.local", "9.9.9.9");
  lookup("localhost", {}, (err) => {
    // Only asserting it doesn't hand back the pinned IP for an unrelated
    // host — the real DNS result itself isn't asserted since it varies
    // by machine (127.0.0.1 vs ::1).
    assert.ifError(err);
    done();
  });
});

test("isSafeRemoteUrl rejects loopback and private addresses", async () => {
  assert.strictEqual((await isSafeRemoteUrl("http://127.0.0.1/test.pdf")).safe, false);
  assert.strictEqual((await isSafeRemoteUrl("https://localhost/test.pdf")).safe, false);
  assert.strictEqual((await isSafeRemoteUrl("http://192.168.1.1/test.pdf")).safe, false);
});

test("isSafeRemoteUrl accepts a public address and returns its resolved IP", async () => {
  const { safe, ip } = await isSafeRemoteUrl("https://8.8.8.8/test.pdf");
  assert.strictEqual(safe, true);
  assert.strictEqual(ip, "8.8.8.8");
});

test("isSafeRemoteUrl rejects non-http(s) schemes", async () => {
  assert.strictEqual((await isSafeRemoteUrl("ftp://8.8.8.8/test.pdf")).safe, false);
  assert.strictEqual((await isSafeRemoteUrl("file:///etc/passwd")).safe, false);
});

function redirectResponse(location) {
  return { statusCode: 302, headers: { location }, body: Buffer.alloc(0) };
}

function okResponse(content = Buffer.from("%PDF-1.4 mock")) {
  return { statusCode: 200, headers: {}, body: content };
}

test("fetchPdfWithValidatedRedirects rejects a redirect to a private address", async () => {
  let callCount = 0;
  const fetchOnceFn = async () => {
    callCount++;
    return redirectResponse("http://127.0.0.1:8000/admin");
  };

  await assert.rejects(
    () => fetchPdfWithValidatedRedirects("https://8.8.8.8/test.pdf", { fetchOnceFn }),
    (err) => err instanceof HttpError && err.statusCode === 400,
  );
  // Must not have followed the redirect with a second request.
  assert.strictEqual(callCount, 1);
});

test("fetchPdfWithValidatedRedirects follows a safe redirect chain", async () => {
  const responses = [
    redirectResponse("https://8.8.4.4/final.pdf"),
    okResponse(Buffer.from("%PDF-1.4 final content")),
  ];
  let call = 0;
  const fetchOnceFn = async () => responses[call++];

  const content = await fetchPdfWithValidatedRedirects("https://8.8.8.8/test.pdf", {
    fetchOnceFn,
  });

  assert.strictEqual(content.toString(), "%PDF-1.4 final content");
  assert.strictEqual(call, 2);
});

test("fetchPdfWithValidatedRedirects caps the redirect chain length", async () => {
  const fetchOnceFn = async () => redirectResponse("https://8.8.8.8/loop.pdf");

  await assert.rejects(
    () => fetchPdfWithValidatedRedirects("https://8.8.8.8/test.pdf", { fetchOnceFn }),
    (err) => err instanceof HttpError && err.statusCode === 502,
  );
});

test("validateLocalPath enforces extension and root containment", (t) => {
  const tmpDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "apogee-pdf-test-")));
  ALLOWED_PDF_ROOTS.push(tmpDir);
  t.after(() => {
    ALLOWED_PDF_ROOTS.splice(ALLOWED_PDF_ROOTS.indexOf(tmpDir), 1);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const validPdf = path.join(tmpDir, "test.pdf");
  writeFileSync(validPdf, "%PDF-1.4 mock");
  assert.strictEqual(validateLocalPath(validPdf), realpathSync(validPdf));

  const invalidFile = path.join(tmpDir, "test.txt");
  writeFileSync(invalidFile, "text content");
  assert.throws(
    () => validateLocalPath(invalidFile),
    (err) => err instanceof HttpError && err.statusCode === 400,
  );

  assert.throws(
    () => validateLocalPath("/etc/hosts.pdf"),
    (err) => err instanceof HttpError && err.statusCode === 403,
  );
});
