import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createCheckout } = await import(pathToFileURL(join(root, "src/index.mjs")));

test("a sparse payload with a named property is rejected without state mutation", async () => {
  const service = createCheckout({ tenant: { sku: 1 } });
  const before = service.snapshot();
  const payload = Array(1);
  payload.extra = "not an indexed element";
  await assert.rejects(service.checkout({ tenantId: "tenant", orderId: "order", sku: "sku", quantity: 1, idempotencyKey: "key", payload }));
  assert.deepEqual(service.snapshot(), before);
});
