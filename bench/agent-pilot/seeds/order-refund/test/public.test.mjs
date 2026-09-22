import assert from "node:assert/strict";
import { test } from "node:test";
import { createLedger, createRefundService } from "../src/index.mjs";

const order = { id: "order-7", lines: [{ id: "item-a", unitPrice: 12.5, quantity: 1 }, { id: "item-b", unitPrice: 3.35, quantity: 2 }] };

test("refunds selected lines at cent precision", () => {
  const ledger = createLedger();
  const result = createRefundService({ ledger }).refund(order, { requestId: "r-1", lineIds: ["item-b"] });
  assert.equal(result.amountCents, 670);
  assert.equal(result.amount, 6.7);
});

test("retrying a request does not create a second ledger entry", () => {
  const ledger = createLedger();
  const service = createRefundService({ ledger });
  const first = service.refund(order, { requestId: "r-2", lineIds: ["item-a"] });
  const second = service.refund(order, { requestId: "r-2", lineIds: ["item-a"] });
  assert.deepEqual(second, first);
  assert.equal(ledger.all().length, 1);
});
