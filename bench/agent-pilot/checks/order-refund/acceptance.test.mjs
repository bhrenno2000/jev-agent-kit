import assert from "node:assert/strict";
import { test } from "node:test";
import { createLedger, createRefundService } from "../../seeds/order-refund/src/index.mjs";

test("same request id is idempotent even with a fresh request object", () => {
  const ledger = createLedger();
  const service = createRefundService({ ledger });
  const order = { id: "o-1", lines: [{ id: "i-1", unitPrice: 0.1, quantity: 3 }] };
  const first = service.refund(order, { requestId: "same", lineIds: ["i-1"] });
  const again = service.refund(order, { requestId: "same", lineIds: ["i-1"] });
  assert.deepEqual(again, first);
  assert.equal(ledger.all().length, 1);
});

test("same request id cannot be reused for a different refund", () => {
  const service = createRefundService({ ledger: createLedger() });
  const one = { id: "o-1", lines: [{ id: "i-1", unitPrice: 4.01, quantity: 1 }] };
  const two = { id: "o-2", lines: [{ id: "i-2", unitPrice: 4.01, quantity: 1 }] };
  service.refund(one, { requestId: "same", lineIds: ["i-1"] });
  assert.throws(() => service.refund(two, { requestId: "same", lineIds: ["i-2"] }));
});

test("partial refunds remain bounded and use integer cents", () => {
  const ledger = createLedger();
  const service = createRefundService({ ledger });
  const order = { id: "o-3", lines: [{ id: "a", unitPrice: 2.005, quantity: 1 }, { id: "b", unitPrice: 1.995, quantity: 1 }] };
  assert.equal(service.refund(order, { requestId: "a", lineIds: ["a"] }).amountCents, 201);
  assert.equal(service.refund(order, { requestId: "b", lineIds: ["b"] }).amountCents, 200);
  assert.throws(() => service.refund(order, { requestId: "c", lineIds: ["a"] }));
});
