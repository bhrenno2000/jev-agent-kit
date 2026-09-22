import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequestCache } from "../src/index.mjs";

test("coalesces concurrent reads and caches the result", async () => {
  let now = 10;
  let calls = 0;
  const cache = createRequestCache({ clock: () => now, ttlMs: 20 });
  const loader = async () => {
    calls += 1;
    return { value: 7 };
  };
  const [a, b] = await Promise.all([cache.get("item", loader), cache.get("item", loader)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal((await cache.get("item", loader)).value, 7);
  now = 31;
  assert.equal((await cache.get("item", loader)).value, 7);
  assert.equal(calls, 2);
});
