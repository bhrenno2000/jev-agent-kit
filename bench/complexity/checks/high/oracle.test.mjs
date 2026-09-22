import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const { createInventorySystem } = await import(
  pathToFileURL(join(import.meta.dirname, "reference/src/index.mjs"))
);
const req = (extra = {}) => ({
  tenantId: "tenant-a",
  orderId: "order-a",
  sku: "widget",
  quantity: 1,
  idempotencyKey: "request-a",
  ...extra,
});

test("reference satisfies the high benchmark contract", async () => {
  const s = createInventorySystem({
    "tenant-a:widget": 2,
    "tenant-a:gadget": 1,
    "tenant-b:widget": 1,
  });
  const first = await s.reserve(req());
  assert.deepEqual(await s.reserve(req()), first);
  await s.checkout(req({ idempotencyKey: "checkout" }));
  s.faults.failNext("persist");
  await assert.rejects(() =>
    s.reserve(req({ orderId: "gadget", sku: "gadget", idempotencyKey: "fault" })),
  );
  await s.reserve(req({ orderId: "gadget", sku: "gadget", idempotencyKey: "fault" }));
});
