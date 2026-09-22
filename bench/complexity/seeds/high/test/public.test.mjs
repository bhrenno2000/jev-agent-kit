import assert from "node:assert/strict";
import { test } from "node:test";
import { createInventorySystem } from "../src/index.mjs";

test("concurrent last-unit reservations have one winner", async () => {
  const service = createInventorySystem({ "tenant-a:widget": 1 });
  const results = await Promise.allSettled([
    service.reserve({
      tenantId: "tenant-a",
      orderId: "a",
      sku: "widget",
      quantity: 1,
      idempotencyKey: "a",
    }),
    service.reserve({
      tenantId: "tenant-a",
      orderId: "b",
      sku: "widget",
      quantity: 1,
      idempotencyKey: "b",
    }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
});

test("failed persistence leaves no reservation or event", async () => {
  const service = createInventorySystem({ "tenant-a:widget": 1 });
  service.faults.failNext("persist");
  await assert.rejects(() =>
    service.reserve({
      tenantId: "tenant-a",
      orderId: "a",
      sku: "widget",
      quantity: 1,
      idempotencyKey: "r",
    }),
  );
  assert.equal(service.snapshot().stock["tenant-a:widget"], 1);
  assert.equal(service.events().length, 0);
});
