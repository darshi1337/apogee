import test from "node:test";
import assert from "node:assert";

import { cleanText } from "../src/utils/cleaner.js";

test("cleanText collapses blank lines and horizontal whitespace", () => {
  const input = "Line one.\n\n\n\nLine two.   has   extra   spaces.\n  leading and trailing  \n";
  assert.strictEqual(
    cleanText(input),
    "Line one.\n\nLine two. has extra spaces.\nleading and trailing",
  );
});
