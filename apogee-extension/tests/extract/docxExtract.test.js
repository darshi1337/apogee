import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { extractDocxText } from "../../lib/extract/docxExtract.js";
import { MAX_DOCX_ENTRIES } from "../../lib/extract/fileLimits.js";

function storedDocx(documentXml) {
  const encoder = new TextEncoder();
  const name = encoder.encode("word/document.xml");
  const content = encoder.encode(documentXml);
  const local = new Uint8Array(30 + name.length + content.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(8, 0, true);
  localView.setUint16(10, 0, true);
  localView.setUint32(18, content.length, true);
  localView.setUint32(22, content.length, true);
  localView.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(content, 30 + name.length);

  const central = new Uint8Array(46 + name.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(20, content.length, true);
  centralView.setUint32(24, content.length, true);
  centralView.setUint16(28, name.length, true);
  central.set(name, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);

  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local);
  zip.set(central, local.length);
  zip.set(end, local.length + central.length);
  return zip.buffer;
}

test("extractDocxText preserves headings, paragraphs, and XML entities", async () => {
  const xml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Research &amp; Results</w:t></w:r></w:p>
    <w:p><w:r><w:t>Water &lt; air</w:t></w:r><w:r><w:tab/><w:t>confirmed.</w:t></w:r></w:p>
  </w:body></w:document>`;

  assert.equal(
    await extractDocxText(storedDocx(xml)),
    "# Research & Results\n\nWater < air\tconfirmed.",
  );
});

test("extractDocxText rejects malformed archives", async () => {
  await assert.rejects(
    extractDocxText(new Uint8Array([1, 2, 3]).buffer),
    /valid DOCX archive|corrupt/i,
  );
});

function deflatedDocx(documentXml) {
  const encoder = new TextEncoder();
  const name = encoder.encode("word/document.xml");
  const content = zlib.deflateRawSync(encoder.encode(documentXml));
  const local = new Uint8Array(30 + name.length + content.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(8, 0, true);
  localView.setUint16(10, 8, true);
  localView.setUint32(18, content.length, true);
  localView.setUint32(22, encoder.encode(documentXml).length, true);
  localView.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(content, 30 + name.length);

  const central = new Uint8Array(46 + name.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(10, 8, true);
  centralView.setUint32(20, content.length, true);
  centralView.setUint32(24, encoder.encode(documentXml).length, true);
  centralView.setUint16(28, name.length, true);
  central.set(name, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);

  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local);
  zip.set(central, local.length);
  zip.set(end, local.length + central.length);
  return zip.buffer;
}

test("extractDocxText inflates a legitimately compressed document", async () => {
  const xml = `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Hello deflated world.</w:t></w:r></w:p></w:body></w:document>`;
  assert.equal(
    await extractDocxText(deflatedDocx(xml)),
    "Hello deflated world.",
  );
});

test("extractDocxText rejects a deflate bomb past the expansion ceiling (#184)", async () => {
  const xml =
    `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>` +
    "a".repeat(2 * 1024 * 1024) +
    `</w:t></w:r></w:p></w:body></w:document>`;
  await assert.rejects(
    extractDocxText(deflatedDocx(xml)),
    /unreasonable size/i,
  );
});

test("extractDocxText rejects an archive claiming too many entries (#184)", async () => {
  const bytes = new Uint8Array(storedDocx("<w:document/>"));
  const view = new DataView(bytes.buffer);
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      view.setUint16(i + 10, MAX_DOCX_ENTRIES + 1, true);
      break;
    }
  }
  await assert.rejects(extractDocxText(bytes.buffer), /corrupt/i);
});
