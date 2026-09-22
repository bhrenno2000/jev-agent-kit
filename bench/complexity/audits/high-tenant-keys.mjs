import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.BENCH_WORKSPACE) throw new Error("BENCH_WORKSPACE is required");
const { createInventorySystem } = await import(
  pathToFileURL(resolve(process.env.BENCH_WORKSPACE, "src/index.mjs"))
);
const request = (tenantId, orderId, idempotencyKey) => ({
  tenantId,
  orderId,
  idempotencyKey,
  sku: "widget",
  quantity: 1,
});
const cases = [
  [
    "tenant and order separators do not alias",
    request("a:b", "c", "first"),
    request("a", "b:c", "second"),
  ],
  [
    "tenant and idempotency separators do not alias",
    request("a:b", "one", "c"),
    request("a", "two", "b:c"),
  ],
];
const results = [];
for (const [name, first, second] of cases) {
  try {
    const system = createInventorySystem({ "a:b:widget": 1, "a:widget": 1 });
    const left = await system.reserve(first);
    const right = await system.reserve(second);
    assert.equal(left.tenantId, first.tenantId);
    assert.equal(right.tenantId, second.tenantId);
    assert.deepEqual(await system.reserve(first), left);
    assert.deepEqual(await system.reserve(second), right);
    assert.equal(system.events().length, 2);
    assert.deepEqual(system.snapshot().stock, { "a:b:widget": 0, "a:widget": 0 });
    results.push({ name, passes: true });
  } catch (error) {
    results.push({ name, passes: false, error: error.message });
  }
}
process.stdout.write(JSON.stringify(results, null, 2) + "\n");
process.exitCode = results.every((result) => result.passes) ? 0 : 1;
