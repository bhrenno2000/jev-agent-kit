import assert from "node:assert/strict";
import { test } from "node:test";
import { listCatalog } from "../src/index.mjs";
test("filters and pages", () => {
  const records = [
    { id: "1", name: "Alpha", category: "book" },
    { id: "2", name: "Beta", category: "game" },
    { id: "3", name: "Alpine", category: "book" },
  ];
  assert.deepEqual(listCatalog(records, { category: "book", query: "AL", limit: 1 }), {
    items: [{ id: "1", name: "Alpha", category: "book" }],
    total: 2,
    nextOffset: 1,
  });
});
