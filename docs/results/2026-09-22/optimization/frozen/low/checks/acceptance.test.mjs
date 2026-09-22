import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { listCatalog } = await import(pathToFileURL(join(root, "src/index.mjs")));
const source = [
  { id: "a", name: "Alpha", category: "book", meta: { x: 1 } },
  { id: "b", name: "Beta", category: "game", meta: { x: 2 } },
  { id: "c", name: "Alpine", category: "book", meta: { x: 3 } },
];
test("exact shape and stable filters", () => {
  const result = listCatalog(source, { category: "book", query: "AL", limit: 10 });
  assert.deepEqual(Object.keys(result).sort(), ["items", "nextOffset", "total"]);
  assert.deepEqual(
    result.items.map((x) => x.id),
    ["a", "c"],
  );
  assert.equal(result.total, 2);
  assert.equal(result.nextOffset, null);
});
test("zero limit retains total and no continuation", () => {
  assert.deepEqual(listCatalog(source, { limit: 0 }), { items: [], total: 3, nextOffset: null });
});
test("offset beyond end is empty", () => {
  assert.deepEqual(listCatalog(source, { offset: 9, limit: 2 }), {
    items: [],
    total: 3,
    nextOffset: null,
  });
});
test("invalid values reject", () => {
  for (const options of [
    { offset: -1 },
    { limit: -1 },
    { offset: 1.2 },
    { limit: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.throws(() => listCatalog(source, options), /invalid options/);
});
test("input and output ownership are isolated", () => {
  const before = structuredClone(source);
  const result = listCatalog(source, { limit: 1 });
  result.items[0].meta.x = 99;
  assert.deepEqual(source, before);
});
console.log("low acceptance complete");

test("continuations cover the filtered stream once in stable order", () => {
  const records = Array.from({ length: 47 }, (_, index) => ({
    id: String(index),
    name: index % 3 === 0 ? "ALPHA" : "Beta",
    category: index % 2 === 0 ? "" : "other",
    nested: { index },
  }));
  const seen = [];
  let offset = 0;
  do {
    const page = listCatalog(records, { category: "", query: "alpha", offset, limit: 3 });
    assert.equal(page.total, 8);
    seen.push(...page.items.map((item) => item.id));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(seen, ["0", "6", "12", "18", "24", "30", "36", "42"]);
  assert.deepEqual(listCatalog([], {}), { items: [], total: 0, nextOffset: null });
});

test("invalid numeric options reject before reading records", () => {
  let reads = 0;
  const records = new Proxy([], {
    get() {
      reads++;
      throw new Error("unexpected read");
    },
  });
  for (const value of [null, "0", NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => listCatalog(records, { limit: value }), /invalid options/);
    assert.throws(() => listCatalog(records, { offset: value }), /invalid options/);
  }
  assert.equal(reads, 0);
});
