import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyedCache } from "../src/index.mjs";

test("a fresh value is reused before expiry", async () => {
  let now = 10;
  let calls = 0;
  const cache = createKeyedCache({ clock: { now: () => now } });
  const load = async () => {
    calls += 1;
    return "value";
  };
  assert.equal(await cache.get("tenant-a", "item", load, 10), "value");
  now = 19;
  assert.equal(await cache.get("tenant-a", "item", load, 10), "value");
  assert.equal(calls, 1);
});

test("same-scope concurrent reads share a load", async () => {
  let calls = 0;
  const cache = createKeyedCache();
  const load = async () => {
    calls += 1;
    await Promise.resolve();
    return 3;
  };
  const values = await Promise.all([
    cache.get("tenant-a", "item", load, 100),
    cache.get("tenant-a", "item", load, 100),
  ]);
  assert.deepEqual(values, [3, 3]);
  assert.equal(calls, 1);
});
