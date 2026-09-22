import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalogApi, fetchAllPages } from "../src/index.mjs";

test("fetches a complete catalog", async () => {
  const api = createCatalogApi();
  assert.deepEqual(await fetchAllPages(api), ["alpha", "beta", "gamma", "delta", "epsilon"]);
});

test("honors a page limit", async () => {
  const api = createCatalogApi();
  await assert.rejects(fetchAllPages(api, { maxPages: 2 }), /page limit/);
});
