import test from "node:test";
import assert from "node:assert";
import {
  timestampToSeconds,
  formatSecondsAsTimestamp,
} from "../../lib/summarize/timestamps.js";

test("timestampToSeconds converts timestamps to second offsets", () => {
  assert.strictEqual(timestampToSeconds("1:23:45"), 5025);
  assert.strictEqual(timestampToSeconds("4:20"), 260);
  assert.strictEqual(timestampToSeconds("0:00"), 0);
});

test("formatSecondsAsTimestamp formats offsets with and without hours", () => {
  assert.strictEqual(formatSecondsAsTimestamp(5025), "1:23:45");
  assert.strictEqual(formatSecondsAsTimestamp(260), "4:20");
  assert.strictEqual(formatSecondsAsTimestamp(0), "0:00");
});

test("timestamp helpers preserve canonical timestamps through a round trip", () => {
  for (const timestamp of ["0:00", "4:20", "1:23:45"]) {
    assert.strictEqual(
      formatSecondsAsTimestamp(timestampToSeconds(timestamp)),
      timestamp,
    );
  }
});
