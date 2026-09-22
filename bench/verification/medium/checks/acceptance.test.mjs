import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createKeyedCache } = await import(pathToFileURL(join(root, "src/index.mjs")));

test("expiry reloads at the exact boundary", async () => {
  let now = 100;
  let calls = 0;
  const cache = createKeyedCache({ clock: { now: () => now } });
  const load = async () => `v-${++calls}`;
  assert.equal(await cache.get("tenant-a", "item", load, 10), "v-1");
  now = 109;
  assert.equal(await cache.get("tenant-a", "item", load, 10), "v-1");
  now = 110;
  assert.equal(await cache.get("tenant-a", "item", load, 10), "v-2");
});

test("zero TTL expires immediately", async () => {
  let calls = 0;
  const cache = createKeyedCache({ clock: { now: () => 5 } });
  const load = async () => `v-${++calls}`;
  assert.equal(await cache.get("tenant-a", "item", load, 0), "v-1");
  assert.equal(await cache.get("tenant-a", "item", load, 0), "v-2");
});

test("expiry starts when the loader resolves", async () => {
  let now = 10;
  const cache = createKeyedCache({ clock: { now: () => now } });
  const load = async () => {
    now = 50;
    return "loaded";
  };
  assert.equal(await cache.get("tenant-a", "item", load, 10), "loaded");
  now = 59;
  assert.equal(await cache.get("tenant-a", "item", async () => "cached", 10), "loaded");
  now = 60;
  assert.equal(await cache.get("tenant-a", "item", async () => "reloaded", 10), "reloaded");
});

test("same-scope concurrent misses coalesce", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const cache = createKeyedCache();
  const load = async () => {
    calls += 1;
    await gate;
    return "loaded";
  };
  const first = cache.get("tenant-a", "item", load, 100);
  const second = cache.get("tenant-a", "item", load, 100);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ["loaded", "loaded"]);
});

test("rejected loads release the key for a later retry", async () => {
  let calls = 0;
  const cache = createKeyedCache();
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary");
    return "recovered";
  };
  await assert.rejects(() => cache.get("tenant-a", "item", load, 100), /temporary/);
  assert.equal(await cache.get("tenant-a", "item", load, 100), "recovered");
  assert.equal(calls, 2);
});

test("coalesced rejection reaches all waiters and permits retry", async () => {
  let calls = 0;
  const cache = createKeyedCache();
  const load = async () => {
    calls += 1;
    throw new Error("temporary");
  };
  const results = await Promise.allSettled([
    cache.get("tenant-a", "item", load, 100),
    cache.get("tenant-a", "item", load, 100),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(
    await cache.get(
      "tenant-a",
      "item",
      async () => {
        calls += 1;
        return "ok";
      },
      100,
    ),
    "ok",
  );
});

test("synchronous loader throws are retryable", async () => {
  const cache = createKeyedCache();
  await assert.rejects(
    () =>
      cache.get(
        "tenant-a",
        "item",
        () => {
          throw new Error("sync");
        },
        100,
      ),
    /sync/,
  );
  assert.equal(await cache.get("tenant-a", "item", () => "ok", 100), "ok");
});

test("synchronous throw is shared by waiters and then recoverable", async () => {
  let calls = 0;
  const cache = createKeyedCache();
  const failing = () => {
    calls += 1;
    throw new Error("sync-shared");
  };
  const results = await Promise.allSettled([
    cache.get("tenant-a", "item", failing, 100),
    cache.get("tenant-a", "item", failing, 100),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(await cache.get("tenant-a", "item", () => "recovered", 100), "recovered");
});

test("same keys in different scopes remain isolated", async () => {
  let calls = 0;
  const cache = createKeyedCache();
  const load = async () => `value-${++calls}`;
  assert.equal(await cache.get("tenant-a", "item", load, 100), "value-1");
  assert.equal(await cache.get("tenant-b", "item", load, 100), "value-2");
  assert.equal(await cache.get("tenant-a", "item", load, 100), "value-1");
  assert.equal(await cache.get("tenant-b", "item", load, 100), "value-2");
  assert.equal(calls, 2);
});

test("different scopes coalesce independently for the same key", async () => {
  let calls = 0;
  const cache = createKeyedCache();
  const load = async () => {
    calls += 1;
    return calls;
  };
  const values = await Promise.all([
    cache.get("tenant-a", "item", load, 100),
    cache.get("tenant-b", "item", load, 100),
  ]);
  assert.deepEqual(values, [1, 2]);
  assert.equal(calls, 2);
});

test("delimiter-containing scope and key pairs remain distinct", async () => {
  let calls = 0;
  const cache = createKeyedCache();
  const load = async () => `v-${++calls}`;
  assert.equal(await cache.get("a:b", "c", load, 100), "v-1");
  assert.equal(await cache.get("a", "b:c", load, 100), "v-2");
  assert.equal(calls, 2);
});

test("clear removes only one fulfilled entry and size retains other entries", async () => {
  const cache = createKeyedCache();
  await cache.get("tenant-a", "item", () => "a", 100);
  await cache.get("tenant-b", "item", () => "b", 100);
  assert.equal(cache.size(), 2);
  cache.clear("tenant-a", "item");
  assert.equal(cache.size(), 1);
  assert.equal(await cache.get("tenant-b", "item", () => "changed", 100), "b");
  assert.equal(await cache.get("tenant-a", "item", () => "new", 100), "new");
  assert.equal(cache.size(), 2);
});

test("size counts physically stored entries after expiry and reload", async () => {
  let now = 1;
  const cache = createKeyedCache({ clock: { now: () => now } });
  await cache.get("tenant-a", "item", () => "a", 1);
  now = 2;
  assert.equal(cache.size(), 1);
  await cache.get("tenant-a", "item", () => "b", 1);
  assert.equal(cache.size(), 1);
});

test("invalid inputs reject consistently", async () => {
  const cache = createKeyedCache();
  for (const call of [
    () => cache.get("", "item", () => "x", 1),
    () => cache.get("tenant-a", "", () => "x", 1),
    () => cache.get("tenant-a", "item", null, 1),
    () => cache.get("tenant-a", "item", () => "x", -1),
    () => cache.get("tenant-a", "item", () => "x", 1.5),
  ])
    await assert.rejects(call);
  assert.throws(() => createKeyedCache({ clock: { now: "not-a-function" } }));
  await assert.rejects(() =>
    createKeyedCache({ clock: { now: () => Infinity } }).get("tenant-a", "item", () => "x", 1),
  );
});
