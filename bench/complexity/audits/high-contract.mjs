import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createInventorySystem } = await import(pathToFileURL(join(root, "src/index.mjs")));
const request = (extra = {}) => ({
  tenantId: "tenant-a",
  orderId: "order-a",
  sku: "widget",
  quantity: 1,
  idempotencyKey: "reserve-a",
  ...extra,
});
const results = [];
async function check(name, work) {
  try {
    await work();
    results.push({ name, passes: true });
  } catch (error) {
    results.push({
      name,
      passes: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await check("invalid requests reject before mutation", async () => {
  for (const invalid of [
    {},
    request({ tenantId: "" }),
    request({ orderId: "" }),
    request({ sku: "" }),
    request({ idempotencyKey: "" }),
    ...[0, -1, 1.5, NaN].map((quantity) => request({ quantity })),
  ]) {
    const service = createInventorySystem({ "tenant-a:widget": 5 });
    const before = structuredClone(service.snapshot());
    await assert.rejects(() => service.reserve(invalid));
    assert.deepEqual(service.snapshot(), before);
    assert.deepEqual(service.events(), []);
  }
});

await check("same-order second reserve rejects without side effects", async () => {
  const service = createInventorySystem({ "tenant-a:widget": 2 });
  await service.reserve(request());
  const before = structuredClone(service.snapshot());
  const eventsBefore = structuredClone(service.events());
  await assert.rejects(() => service.reserve(request({ idempotencyKey: "reserve-b" })));
  assert.deepEqual(service.snapshot(), before);
  assert.deepEqual(service.events(), eventsBefore);
});

await check("original reserve result remains stable after checkout", async () => {
  const service = createInventorySystem({ "tenant-a:widget": 1 });
  const first = await service.reserve(request());
  const original = structuredClone(first);
  await service.checkout(request({ idempotencyKey: "checkout-a" }));
  assert.deepEqual(first, original);
  assert.deepEqual(await service.reserve(request()), original);
  assert.equal(original.status, "reserved");
});

await check("rollback restores the complete prior state and outbox", async () => {
  const service = createInventorySystem({ "tenant-a:widget": 1, "tenant-a:gadget": 1 });
  await service.reserve(request());
  const before = structuredClone(service.snapshot());
  const eventsBefore = structuredClone(service.events());
  service.faults.failNext("persist");
  await assert.rejects(() =>
    service.reserve(
      request({ sku: "gadget", orderId: "gadget", idempotencyKey: "reserve-gadget" }),
    ),
  );
  assert.deepEqual(service.snapshot(), before);
  assert.deepEqual(service.events(), eventsBefore);
});

process.stdout.write(JSON.stringify(results, null, 2) + "\n");
if (results.some((result) => !result.passes)) process.exitCode = 1;
