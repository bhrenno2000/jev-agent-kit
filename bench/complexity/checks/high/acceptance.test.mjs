import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createInventorySystem } = await import(pathToFileURL(join(root, "src/index.mjs")));
const req = (extra = {}) => ({
  tenantId: "tenant-a",
  orderId: "order-a",
  sku: "widget",
  quantity: 1,
  idempotencyKey: "request-a",
  ...extra,
});

test("exact reserve retry is idempotent", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 2 });
  const first = await s.reserve(req());
  assert.deepEqual(await s.reserve(req()), first);
  assert.equal(s.events().filter((event) => event.type === "inventory.reserved").length, 1);
});
test("concurrent identical reserve requests share one effect", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1 });
  const results = await Promise.all([s.reserve(req()), s.reserve(req())]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(s.snapshot().stock["tenant-a:widget"], 0);
  assert.equal(s.events().length, 1);
});
test("concurrent distinct reserve requests have one last-unit winner", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1 });
  const results = await Promise.allSettled([
    s.reserve(req({ idempotencyKey: "one", orderId: "one" })),
    s.reserve(req({ idempotencyKey: "two", orderId: "two" })),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
});
test("idempotency key rejects changed reserve payload", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 2 });
  await s.reserve(req());
  await assert.rejects(() => s.reserve(req({ orderId: "other" })), /idempotency|conflict/i);
});
test("checkout requires an existing reservation", async () => {
  await assert.rejects(
    () =>
      createInventorySystem({ "tenant-a:widget": 1 }).checkout(req({ idempotencyKey: "checkout" })),
    /reservation|not found/i,
  );
});
test("tenant and order scope cannot cross", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1, "tenant-b:widget": 1 });
  await s.reserve(req());
  await assert.rejects(
    () => s.checkout(req({ tenantId: "tenant-b", idempotencyKey: "checkout" })),
    /reservation|not found/i,
  );
  await assert.rejects(
    () => s.checkout(req({ orderId: "other", idempotencyKey: "checkout-2" })),
    /reservation|not found/i,
  );
});
test("checkout rejects mismatched item arguments", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1 });
  await s.reserve(req());
  await assert.rejects(
    () => s.checkout(req({ sku: "gadget", idempotencyKey: "checkout" })),
    /mismatch|conflict|reservation/i,
  );
  await assert.rejects(
    () => s.checkout(req({ quantity: 2, idempotencyKey: "checkout-2" })),
    /mismatch|conflict|reservation/i,
  );
});
test("failed reservation persistence can be retried cleanly", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1 });
  s.faults.failNext("persist");
  await assert.rejects(() => s.reserve(req()));
  assert.equal(s.snapshot().stock["tenant-a:widget"], 1);
  await s.reserve(req());
  assert.equal(s.events().length, 1);
});
test("failed checkout persistence can be retried cleanly", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1 });
  await s.reserve(req());
  s.faults.failNext("persist");
  await assert.rejects(() => s.checkout(req({ idempotencyKey: "checkout" })));
  await s.checkout(req({ idempotencyKey: "checkout" }));
  assert.equal(s.events().filter((event) => event.type === "inventory.checked_out").length, 1);
});
test("multiple tenants and SKUs retain independent stock", async () => {
  const s = createInventorySystem({
    "tenant-a:widget": 1,
    "tenant-a:gadget": 2,
    "tenant-b:widget": 1,
  });
  await s.reserve(req({ sku: "gadget", idempotencyKey: "gadget" }));
  await s.reserve(req({ tenantId: "tenant-b", orderId: "b", idempotencyKey: "b" }));
  assert.deepEqual(s.snapshot().stock, {
    "tenant-a:widget": 1,
    "tenant-a:gadget": 1,
    "tenant-b:widget": 0,
  });
});
test("event payload is immutable after returned result changes", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1 });
  await s.reserve(req({ idempotencyKey: "event" }));
  const before = structuredClone(s.events());
  const result = await s.reserve(req({ idempotencyKey: "event" }));
  result.status = "tampered";
  result.orderId = "other";
  assert.deepEqual(s.events(), before);
});
test("failed transaction does not erase another resource commit", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1, "tenant-a:gadget": 1 });
  s.faults.failNext("persist");
  const results = await Promise.allSettled([
    s.reserve(req({ idempotencyKey: "widget" })),
    s.reserve(req({ sku: "gadget", orderId: "gadget", idempotencyKey: "gadget" })),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  const stock = s.snapshot().stock;
  assert.ok(
    (stock["tenant-a:widget"] === 0 && stock["tenant-a:gadget"] === 1) ||
      (stock["tenant-a:widget"] === 1 && stock["tenant-a:gadget"] === 0),
  );
});
test("reserve and checkout preserve distinct order state", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1, "tenant-a:gadget": 1 });
  await s.reserve(req({ idempotencyKey: "widget" }));
  const results = await Promise.allSettled([
    s.checkout(req({ idempotencyKey: "checkout-widget" })),
    s.reserve(req({ sku: "gadget", orderId: "gadget", idempotencyKey: "gadget" })),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 2);
  assert.equal(s.snapshot().stock["tenant-a:gadget"], 0);
});
test("successful checkout retry returns the stable result and one event", async () => {
  const s = createInventorySystem({ "tenant-a:widget": 1 });
  await s.reserve(req({ idempotencyKey: "reserve" }));
  const first = await s.checkout(req({ idempotencyKey: "checkout" }));
  assert.deepEqual(await s.checkout(req({ idempotencyKey: "checkout" })), first);
  assert.equal(s.events().filter((event) => event.type === "inventory.checked_out").length, 1);
});
