import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createCheckout } = await import(pathToFileURL(join(root, "src/index.mjs")));
const request = (changes = {}) => ({
  tenantId: "tenant",
  orderId: "order",
  sku: "sku",
  quantity: 1,
  idempotencyKey: "key",
  payload: { nested: { value: "original" } },
  ...changes,
});

test("independent: concurrent duplicates commit once and conflicting payload cannot consume stock", async () => {
  const service = createCheckout({ tenant: { sku: 4 } });
  const outcomes = await Promise.allSettled([
    service.checkout(request()),
    service.checkout(request()),
    service.checkout(request({ payload: { conflicting: true } })),
  ]);
  assert.deepEqual(
    outcomes.map((item) => item.status),
    ["fulfilled", "fulfilled", "rejected"],
  );
  assert.deepEqual(outcomes[0].value, outcomes[1].value);
  assert.deepEqual(service.snapshot(), {
    stock: { tenant: { sku: 3 } },
    orders: [outcomes[0].value],
  });
});

test("independent: distinct idempotency keys remain independent for the same order ID", async () => {
  const service = createCheckout({ tenant: { sku: 2 } });
  await service.checkout(request());
  await service.checkout(request({ idempotencyKey: "second" }));
  assert.equal(service.snapshot().stock.tenant.sku, 0);
  assert.equal(service.snapshot().orders.length, 2);
});

test("independent: prototype-like names and JSON keys retain identity without prototype pollution", async () => {
  const initial = Object.fromEntries([
    ["__proto__", Object.fromEntries([["constructor", 2]])],
    ["empty", {}],
  ]);
  const payload = JSON.parse('{"__proto__":{"tag":1},"constructor":2}');
  const service = createCheckout(initial);
  const input = request({ tenantId: "__proto__", sku: "constructor", payload });
  const first = await service.checkout(input);
  const reordered = JSON.parse('{"constructor":2,"__proto__":{"tag":1}}');
  assert.deepEqual(await service.checkout({ ...input, payload: reordered }), first);
  assert.equal(service.snapshot().stock.__proto__.constructor, 1);
  assert.deepEqual(service.snapshot().stock.empty, {});
  assert.equal(Object.prototype.constructor, Object);
  assert.deepEqual(initial.__proto__, { constructor: 2 });
});

test("independent: immediate request and payload mutation cannot change queued work", async () => {
  const service = createCheckout({ tenant: { sku: 1 } });
  const input = request();
  const pending = service.checkout(input);
  input.sku = "missing";
  input.quantity = 99;
  input.idempotencyKey = "changed";
  input.payload.nested.value = "changed";
  const result = await pending;
  assert.deepEqual(result, {
    tenantId: "tenant",
    orderId: "order",
    sku: "sku",
    quantity: 1,
    payload: { nested: { value: "original" } },
    status: "confirmed",
  });
  assert.deepEqual(await service.checkout(request()), result);
});

test("independent: failure flag survives insufficient stock and rollback is exact", async () => {
  const service = createCheckout({ tenant: { sku: 2 } });
  const before = service.snapshot();
  service.failNextPersistence();
  await assert.rejects(service.checkout(request({ sku: "missing" })));
  await assert.rejects(service.checkout(request()));
  assert.deepEqual(service.snapshot(), before);
  const successful = await service.checkout(request());
  assert.deepEqual(service.snapshot(), { stock: { tenant: { sku: 1 } }, orders: [successful] });
});

test("independent: result and snapshot mutations cannot corrupt replay", async () => {
  const service = createCheckout({ tenant: { sku: 2 } });
  const result = await service.checkout(request());
  const expected = structuredClone(result);
  result.payload.nested.value = "mutated";
  const snapshot = service.snapshot();
  snapshot.orders[0].payload.nested.value = "also mutated";
  snapshot.stock.tenant.sku = 200;
  assert.deepEqual(await service.checkout(request()), expected);
  assert.deepEqual(service.snapshot(), { stock: { tenant: { sku: 1 } }, orders: [expected] });
});

test("independent: unsupported JSON values reject before mutation", async () => {
  const cycle = {};
  cycle.self = cycle;
  const payloads = [
    NaN,
    Infinity,
    1n,
    Symbol("x"),
    () => 1,
    new Date(),
    new Map(),
    cycle,
    { nested: undefined },
    Array(2),
  ];
  for (const payload of payloads) {
    const service = createCheckout({ tenant: { sku: 2 } });
    const before = service.snapshot();
    await assert.rejects(service.checkout(request({ payload })));
    assert.deepEqual(service.snapshot(), before);
  }
});

test("independent: a named property cannot hide a missing JSON array element", async () => {
  const service = createCheckout({ tenant: { sku: 1 } });
  const before = service.snapshot();
  const payload = Array(1);
  payload.extra = "not an indexed element";
  await assert.rejects(service.checkout(request({ payload })));
  assert.deepEqual(service.snapshot(), before);
});

test("independent: queued capacity remains conserved across many distinct requests", async () => {
  const service = createCheckout({ tenant: { sku: 7 } });
  const outcomes = await Promise.allSettled(
    Array.from({ length: 15 }, (_, index) =>
      service.checkout(request({ orderId: String(index), idempotencyKey: String(index) })),
    ),
  );
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 7);
  const snapshot = service.snapshot();
  assert.equal(snapshot.stock.tenant.sku, 0);
  assert.deepEqual(
    snapshot.orders.map((item) => item.orderId),
    ["0", "1", "2", "3", "4", "5", "6"],
  );
});
