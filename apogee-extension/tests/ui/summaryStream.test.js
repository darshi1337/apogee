import test from "node:test";
import assert from "node:assert/strict";
import { renderSummaryStream } from "../../ui/summaryStream.js";

test("a long summary redraws less often while new chunks keep arriving", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const preview = [];
  let countAfterBurst;

  async function* chunks() {
    yield "Short summary";
    for (let i = 0; i < 10; i++) {
      t.mock.timers.tick(10);
      yield ".";
    }
    const shortRenderCount = preview.length;
    assert.ok(shortRenderCount >= 2, "short text previews promptly");

    yield "a".repeat(48 * 1024);
    t.mock.timers.tick(300);
    const longStartCount = preview.length;
    for (let i = 0; i < 10; i++) {
      t.mock.timers.tick(10);
      yield ".";
    }
    assert.equal(preview.length, longStartCount);
    t.mock.timers.tick(160);
    assert.equal(preview.length, longStartCount + 1);
    assert.ok(preview.at(-1).endsWith(".........."));
    countAfterBurst = preview.length;
  }

  await renderSummaryStream(chunks(), (text) => preview.push(text));
  assert.equal(preview.length, countAfterBurst + 1);
});

test("completion renders the full cleaned summary immediately and cancels the preview", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const renders = [];
  async function* chunks() {
    yield "  ";
    t.mock.timers.tick(500);
    assert.deepEqual(renders, []);
    yield "## Summary\n";
    yield "**Complete**";
  }

  const result = await renderSummaryStream(chunks(), (text) =>
    renders.push(text),
  );
  assert.equal(result, "**Complete**");
  t.mock.timers.tick(500);
  assert.deepEqual(renders, [result]);
});

test("a rejected stream cannot redraw over the error or a later attempt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const renders = [];
  const error = new Error("stream interrupted");
  async function* chunks() {
    yield "Incomplete";
    throw error;
  }

  await assert.rejects(
    renderSummaryStream(chunks(), (text) => renders.push(text)),
    error,
  );
  t.mock.timers.tick(500);
  assert.deepEqual(renders, []);
});
