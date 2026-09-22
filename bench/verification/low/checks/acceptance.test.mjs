import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { findAvailable, mergeWindows } = await import(pathToFileURL(join(root, "src/index.mjs")));

test("mergeWindows merges overlapping and touching half-open intervals", () => {
  assert.deepEqual(
    mergeWindows([
      { start: 60, end: 120 },
      { start: 120, end: 180 },
      { start: 170, end: 210 },
    ]),
    [{ start: 60, end: 210 }],
  );
  assert.deepEqual(
    mergeWindows([
      { start: 300, end: 360 },
      { start: 60, end: 500 },
      { start: 100, end: 120 },
    ]),
    [{ start: 60, end: 500 }],
  );
});

test("findAvailable returns only slots meeting minGap", () => {
  assert.deepEqual(
    findAvailable(
      [
        { start: 60, end: 120 },
        { start: 180, end: 240 },
      ],
      0,
      400,
      100,
    ),
    [{ start: 240, end: 400 }],
  );
});

test("input and returned records are independent", () => {
  const windows = [
    { start: 120, end: 180 },
    { start: 60, end: 90 },
  ];
  const original = structuredClone(windows);
  const merged = mergeWindows(windows);
  assert.deepEqual(windows, original);
  merged[0].start = 90;
  assert.deepEqual(windows, original);
  assert.deepEqual(mergeWindows(windows), [
    { start: 60, end: 90 },
    { start: 120, end: 180 },
  ]);
  const slots = findAvailable(windows, 0, 180);
  slots[0].end = 1;
  assert.deepEqual(findAvailable(windows, 0, 180), [
    { start: 0, end: 60 },
    { start: 90, end: 120 },
  ]);
});

test("invalid inputs reject without changing caller data", () => {
  const windows = [{ start: 60, end: 120 }];
  assert.throws(() => mergeWindows([{ start: 120, end: 60 }]), /invalid/);
  assert.throws(() => mergeWindows([{ start: -1, end: 60 }]), /invalid/);
  assert.throws(() => mergeWindows([{ start: 60, end: 1441 }]), /invalid/);
  assert.throws(() => findAvailable(windows, 0, 180, -1), /invalid/);
  assert.throws(() => findAvailable(windows, 0, 180, 1.5), /invalid/);
  assert.throws(() => findAvailable(windows, -1, 180), /invalid/);
  assert.throws(() => findAvailable(windows, 0, 1441), /invalid/);
  assert.throws(() => findAvailable(windows, 180, 0), /invalid/);
  assert.deepEqual(windows, [{ start: 60, end: 120 }]);
});

test("record type excludes arrays and functions while allowing custom prototypes", () => {
  const array = Object.assign([], { start: 10, end: 20 });
  const callable = Object.assign(() => {}, { start: 10, end: 20 });
  assert.throws(() => mergeWindows([array]));
  assert.throws(() => mergeWindows([callable]));
  const custom = Object.assign(Object.create({ category: "custom" }), { start: 10, end: 20 });
  const result = mergeWindows([custom]);
  assert.deepEqual(result, [{ start: 10, end: 20 }]);
  assert.notEqual(result[0], custom);
});
