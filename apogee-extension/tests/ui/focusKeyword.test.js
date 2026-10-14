import test from "node:test";
import assert from "node:assert";

import {
  isFocusKeywordSupportedType,
  gateFocusKeyword,
  createKeywordPageTracker,
} from "../../ui/focusKeyword.js";

test("only multi-tab pages skip the keyword path (#388)", () => {
  assert.equal(isFocusKeywordSupportedType("multi-tab"), false);
  for (const type of [
    "article",
    "youtube",
    "bilibili",
    "reddit",
    "selection",
  ]) {
    assert.equal(isFocusKeywordSupportedType(type), true, type);
  }
});

test("the gate trims the raw value on supported types (#319)", () => {
  assert.equal(gateFocusKeyword("  mars  ", "article"), "mars");
  assert.equal(gateFocusKeyword("mars", "youtube"), "mars");
  assert.equal(gateFocusKeyword("mars", "reddit"), "mars");
  assert.equal(gateFocusKeyword(null, "article"), "");
});

test("the gate drops the value on multi-tab pages (#319)", () => {
  assert.equal(gateFocusKeyword("mars", "multi-tab"), "");
});

test("a leftover keyword clears when the tab or URL moves (#413)", () => {
  let cleared = 0;
  const tracker = createKeywordPageTracker({ onClear: () => void cleared++ });
  assert.equal(tracker.handlePageChange(1, "https://a.example"), true);
  assert.equal(cleared, 1);
  assert.equal(tracker.handlePageChange(1, "https://b.example"), true);
  assert.equal(cleared, 2);
  assert.equal(tracker.handlePageChange(2, "https://b.example"), true);
  assert.equal(cleared, 3);
});

test("a same-page re-render keeps the keyword (#413)", () => {
  let cleared = 0;
  const tracker = createKeywordPageTracker({ onClear: () => void cleared++ });
  tracker.handlePageChange(1, "https://a.example");
  assert.equal(tracker.handlePageChange(1, "https://a.example"), false);
  assert.equal(cleared, 1);
});

test("the tracker starts settled and reports later moves", () => {
  let cleared = 0;
  const tracker = createKeywordPageTracker({ onClear: () => void cleared++ });
  assert.equal(tracker.handlePageChange(null, null), false);
  assert.equal(cleared, 0);
  assert.equal(tracker.handlePageChange(1, "https://a.example"), true);
  assert.equal(tracker.handlePageChange(null, null), true);
  assert.equal(cleared, 2);
});
