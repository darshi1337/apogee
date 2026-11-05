import test from "node:test";
import assert from "node:assert";

import { readSource } from "../helpers/readSource.js";

const popupJs = readSource("../../ui/app.js", import.meta.url);

function getPageDataBody() {
  const match = popupJs.match(
    /async function getPageData\(tab\) \{([\s\S]*?)\n\}\n\nlet modelProgressHideTimer/,
  );
  assert.ok(match, "getPageData function found");
  return match[1];
}

// Denial must not fall through to extractFromActiveTab: both popup call
// sites share one combined gate that throws the actionable blocked message.
test("getPageData gates extraction on the combined permission helper (#304)", () => {
  const body = getPageDataBody();
  assert.match(
    body,
    /await ensurePermissionsOrThrow\(tab\.url\);/,
    "must gate on the combined helper instead of ignoring the denial",
  );
  assert.ok(
    !body.includes("ensurePermissionsForUrl(tab.url);"),
    "must not call the raw boolean gate without checking denial",
  );
  assert.match(
    body,
    /const pageData = await extractFromActiveTab\(tab\);/,
    "granted path must still extract (no double prompt)",
  );
});

test("PDF re-extract path gates on the combined permission helper (#304)", () => {
  const match = popupJs.match(
    /let pdfContent = pageData\.content;([\s\S]*?)if \(!pdfContent\) \{([\s\S]*?)\n {6}\}/,
  );
  assert.ok(match, "PDF re-extract block found");
  const block = match[0];
  assert.match(
    block,
    /await ensurePermissionsOrThrow\(tab\.url\);/,
    "must gate on the combined helper instead of ignoring the denial",
  );
  assert.ok(
    !block.includes("ensurePermissionsForUrl(tab.url);"),
    "must not call the raw boolean gate without checking denial",
  );
});
