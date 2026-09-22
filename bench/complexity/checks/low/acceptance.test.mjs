import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.env.BENCH_WORKSPACE;
if (!workspace) throw new Error("BENCH_WORKSPACE is required");
const { createCatalogApi, fetchAllPages } = await import(pathToFileURL(join(workspace, "src/index.mjs")));

test("target follows the complete cursor chain", async () => {
  const api = createCatalogApi();
  assert.deepEqual(await fetchAllPages(api), ["alpha", "beta", "gamma", "delta", "epsilon"]);
  assert.deepEqual(api.calls(), [undefined, "cursor-2", "cursor-3"]);
});

test("target enforces the page limit", async () => {
  const api = createCatalogApi();
  await assert.rejects(fetchAllPages(api, { maxPages: 2 }), /page limit/);
  assert.deepEqual(api.calls(), [undefined, "cursor-2"]);
});

test("target does not mutate frozen API pages", async () => {
  const first = Object.freeze({ items: Object.freeze(["one"]), nextCursor: undefined });
  const api = { async fetchPage(cursor) { assert.equal(cursor, undefined); return first; } };
  assert.deepEqual(await fetchAllPages(api), ["one"]);
  assert.deepEqual(first.items, ["one"]);
});
