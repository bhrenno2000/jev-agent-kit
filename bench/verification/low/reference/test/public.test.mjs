import assert from "node:assert/strict";
import { test } from "node:test";
import { findAvailable, mergeWindows } from "../src/index.mjs";

test("merges an overlapping pair", () => {
  assert.deepEqual(
    mergeWindows([
      { start: 60, end: 120 },
      { start: 90, end: 150 },
    ]),
    [{ start: 60, end: 150 }],
  );
});

test("returns ordinary gaps in a day", () => {
  assert.deepEqual(findAvailable([{ start: 60, end: 120 }], 0, 180), [
    { start: 0, end: 60 },
    { start: 120, end: 180 },
  ]);
});
