import "./independent.test.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createCheckout } = await import(pathToFileURL(join(root, "src/index.mjs")));
const make = (stock) => createCheckout(stock);
const request = (overrides = {}) => ({
  tenantId: "tenant",
  orderId: "order",
  sku: "sku",
  quantity: 1,
  idempotencyKey: "key",
  payload: { total: 3, nested: { ok: true } },
  ...overrides,
});

test("constructs exact nested stock and empty order snapshot", () =>
  assert.deepEqual(make({ tenant: { sku: 2 } }).snapshot(), {
    stock: { tenant: { sku: 2 } },
    orders: [],
  }));
test("isolates equal SKUs across tenants", async () => {
  const service = make({ alpha: { widget: 1 }, beta: { widget: 1 } });
  await Promise.all([
    service.checkout(
      request({
        tenantId: "alpha",
        orderId: "a",
        sku: "widget",
        idempotencyKey: "same",
        payload: null,
      }),
    ),
    service.checkout(
      request({
        tenantId: "beta",
        orderId: "b",
        sku: "widget",
        idempotencyKey: "same",
        payload: null,
      }),
    ),
  ]);
  assert.deepEqual(service.snapshot().stock, { alpha: { widget: 0 }, beta: { widget: 0 } });
});
test("prevents concurrent last-unit oversell", async () => {
  const service = make({ tenant: { sku: 1 } });
  const outcomes = await Promise.allSettled([
    service.checkout(request({ orderId: "one" })),
    service.checkout(request({ orderId: "two", idempotencyKey: "other" })),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(service.snapshot().stock.tenant.sku, 0);
});
test("replays the same idempotent request without another order", async () => {
  const service = make({ tenant: { sku: 2 } });
  const first = await service.checkout(request());
  const replay = await service.checkout(structuredClone(request()));
  assert.deepEqual(replay, first);
  assert.equal(service.snapshot().stock.tenant.sku, 1);
  assert.equal(service.snapshot().orders.length, 1);
});
test("treats object key order as irrelevant and array order as significant", async () => {
  const service = make({ tenant: { sku: 3 } });
  const first = await service.checkout(
    request({ payload: { a: 1, b: { x: true, y: 2 }, list: [1, 2] } }),
  );
  const replay = await service.checkout(
    request({ payload: { list: [1, 2], b: { y: 2, x: true }, a: 1 } }),
  );
  assert.deepEqual(replay, first);
  await assert.rejects(
    service.checkout(request({ payload: { list: [2, 1], b: { x: true, y: 2 }, a: 1 } })),
    /idempotency conflict/,
  );
  assert.equal(service.snapshot().stock.tenant.sku, 2);
});
test("rejects changed order, SKU, quantity, or payload without mutation", async () => {
  const service = make({ tenant: { sku: 3, other: 2 } });
  await service.checkout(request());
  const before = service.snapshot();
  for (const changed of [
    request({ orderId: "other-order" }),
    request({ sku: "other" }),
    request({ quantity: 2 }),
    request({ payload: { changed: true } }),
  ]) {
    await assert.rejects(service.checkout(changed), /idempotency conflict/);
    assert.deepEqual(service.snapshot(), before);
  }
});
test("captures mutable caller request before asynchronous work", async () => {
  const service = make({ tenant: { sku: 1 } });
  const input = request({ payload: { value: "before" } });
  const pending = service.checkout(input);
  input.tenantId = "other";
  input.payload.value = "after";
  await pending;
  assert.equal(service.snapshot().stock.tenant.sku, 0);
  assert.match(JSON.stringify(service.snapshot()), /before/);
});
test("rejects invalid requests before mutation", async () => {
  for (const invalid of [
    request({ tenantId: "" }),
    request({ orderId: "" }),
    request({ sku: "" }),
    request({ idempotencyKey: "" }),
    request({ quantity: 0 }),
    request({ quantity: 1.5 }),
  ]) {
    const service = make({ tenant: { sku: 2 } });
    const before = service.snapshot();
    await assert.rejects(service.checkout(invalid));
    assert.deepEqual(service.snapshot(), before);
  }
});
test("insufficient stock leaves orders and stock unchanged", async () => {
  const service = make({ tenant: { sku: 1 } });
  const before = service.snapshot();
  await assert.rejects(service.checkout(request({ quantity: 2 })), /insufficient stock/);
  assert.deepEqual(service.snapshot(), before);
});
test("persistence failure rolls back and retry succeeds", async () => {
  const service = make({ tenant: { sku: 1 } });
  const before = service.snapshot();
  service.failNextPersistence();
  await assert.rejects(service.checkout(request()), /persistence failure/);
  assert.deepEqual(service.snapshot(), before);
  assert.equal((await service.checkout(request())).status, "confirmed");
});
test("failure flag does not consume on replay, conflict, or invalid request", async () => {
  const service = make({ tenant: { sku: 2 } });
  await service.checkout(request());
  service.failNextPersistence();
  await service.checkout(request());
  assert.equal(service.snapshot().stock.tenant.sku, 1);
  await assert.rejects(
    service.checkout(request({ payload: { conflict: true } })),
    /idempotency conflict/,
  );
  await assert.rejects(
    service.checkout(request({ idempotencyKey: "fresh", quantity: 0 })),
    /invalid request/,
  );
  await assert.rejects(
    service.checkout(request({ idempotencyKey: "fresh", orderId: "new" })),
    /persistence failure/,
  );
});
test("returned result and snapshot are deep copies", async () => {
  const service = make({ tenant: { sku: 1 } });
  const result = await service.checkout(request());
  result.payload.nested.ok = false;
  const snapshot = service.snapshot();
  snapshot.stock.tenant.sku = 99;
  snapshot.orders[0].payload.total = 99;
  assert.equal(service.snapshot().stock.tenant.sku, 0);
  assert.equal(service.snapshot().orders[0].payload.total, 3);
  assert.equal((await service.checkout(request())).payload.nested.ok, true);
});
test("preserves delimiter-bearing tenant and SKU identities", async () => {
  const service = make({ "a:b": { c: 1 }, a: { "b:c": 1 } });
  await Promise.all([
    service.checkout(request({ tenantId: "a:b", sku: "c", orderId: "one", idempotencyKey: "one" })),
    service.checkout(request({ tenantId: "a", sku: "b:c", orderId: "two", idempotencyKey: "two" })),
  ]);
  assert.equal(service.snapshot().stock["a:b"].c, 0);
  assert.equal(service.snapshot().stock.a["b:c"], 0);
});
test("keeps same idempotency keys independent across tenants", async () => {
  const service = make({ alpha: { sku: 1 }, beta: { sku: 1 } });
  await Promise.all([
    service.checkout(request({ tenantId: "alpha", idempotencyKey: "same" })),
    service.checkout(request({ tenantId: "beta", idempotencyKey: "same" })),
  ]);
  assert.equal(service.snapshot().orders.length, 2);
});
test("returns the exact confirmed result contract", async () => {
  const result = await make({ tenant: { sku: 1 } }).checkout(request({ payload: null }));
  assert.deepEqual(result, {
    tenantId: "tenant",
    orderId: "order",
    sku: "sku",
    quantity: 1,
    payload: null,
    status: "confirmed",
  });
});
