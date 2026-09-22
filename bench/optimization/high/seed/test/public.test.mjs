import assert from "node:assert/strict";
import { test } from "node:test";
import { createCheckout } from "../src/index.mjs";

test("successful checkout is idempotent", async () => {
  const system = createCheckout({ acme: { widget: 2 } });
  const request = {
    tenantId: "acme",
    orderId: "o1",
    sku: "widget",
    quantity: 1,
    idempotencyKey: "k1",
    payload: { channel: "web" },
  };
  const first = await system.checkout(request);
  const second = await system.checkout(request);
  assert.deepEqual(second, first);
  assert.equal(system.snapshot().stock.acme.widget, 1);
});
