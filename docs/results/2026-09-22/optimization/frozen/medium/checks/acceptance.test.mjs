import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createRequestCache } = await import(pathToFileURL(join(root, "src/index.mjs")));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("coalesces pending calls and isolates different keys", async () => {
  const cache = createRequestCache({ clock: () => 0, ttlMs: 20 });
  const waiting = deferred();
  let calls = 0;
  const first = cache.get("same", () => {
    calls++;
    return waiting.promise;
  });
  const second = cache.get("same", () => {
    calls++;
    return "incorrect";
  });
  assert.equal(await cache.get("other", () => "isolated"), "isolated");
  await Promise.resolve();
  assert.equal(calls, 1);
  waiting.resolve("shared");
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
});

test("TTL begins at settlement and expires at the exact boundary", async () => {
  let now = 0;
  const cache = createRequestCache({ clock: () => now, ttlMs: 10 });
  const waiting = deferred();
  const first = cache.get("key", () => waiting.promise);
  now = 8;
  waiting.resolve("first");
  assert.equal(await first, "first");
  now = 17;
  assert.equal(await cache.get("key", () => "incorrect"), "first");
  now = 18;
  assert.equal(await cache.get("key", () => "second"), "second");
  const zero = createRequestCache({ clock: () => now, ttlMs: 0 });
  assert.equal(await zero.get("key", () => 1), 1);
  assert.equal(await zero.get("key", () => 2), 2);
});

test("rejected and synchronously throwing loaders are evicted", async () => {
  const cache = createRequestCache({ clock: () => 0 });
  let calls = 0;
  await assert.rejects(
    cache.get("failed", () => {
      calls++;
      throw new Error("failure");
    }),
    /failure/,
  );
  assert.equal(
    await cache.get("failed", () => {
      calls++;
      return "recovered";
    }),
    "recovered",
  );
  assert.equal(calls, 2);
  assert.equal(await cache.get("undefined", () => undefined), undefined);
  assert.equal(await cache.get("undefined", () => "incorrect"), undefined);
});

for (const operation of ["invalidate", "clear"]) {
  for (const outcome of ["resolve", "reject"]) {
    test(`${operation} blocks stale ${outcome} from changing a newer generation`, async () => {
      const cache = createRequestCache({ clock: () => 0, ttlMs: 10 });
      const waiting = deferred();
      const old = cache.get("key", () => waiting.promise);
      const checkedOld = outcome === "reject" ? assert.rejects(old, /stale/) : old;
      if (operation === "clear") cache.clear();
      else cache.invalidate("key");
      assert.equal(await cache.get("key", () => "new"), "new");
      if (outcome === "reject") waiting.reject(new Error("stale"));
      else waiting.resolve("old");
      await checkedOld;
      assert.equal(await cache.get("key", () => "incorrect"), "new");
      assert.equal(cache.size(), 1);
    });
  }
}

test("size counts pending and fresh entries while excluding expired and invalidated entries", async () => {
  let now = 0;
  const cache = createRequestCache({ clock: () => now, ttlMs: 10 });
  const waiting = deferred();
  const pending = cache.get("pending", () => waiting.promise);
  await cache.get("ready", () => 1);
  assert.equal(cache.size(), 2);
  now = 10;
  assert.equal(cache.size(), 1);
  cache.invalidate("pending");
  assert.equal(cache.size(), 0);
  waiting.resolve(2);
  await pending;
  assert.equal(cache.size(), 0);
});

test("validates TTL, key, and loader without invoking rejected loaders", async () => {
  for (const ttlMs of [-1, 1.5, NaN, Infinity, "10", null])
    assert.throws(() => createRequestCache({ ttlMs }));
  const cache = createRequestCache({ clock: () => 0 });
  let calls = 0;
  for (const key of ["", 0, null, undefined, {}, []])
    await assert.rejects(
      cache.get(key, () => {
        calls++;
      }),
    );
  for (const loader of [null, 1, "loader"]) await assert.rejects(cache.get("valid", loader));
  assert.equal(calls, 0);
  assert.equal(cache.size(), 0);
});
