import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.env.BENCH_WORKSPACE;
if (!workspace) throw new Error("BENCH_WORKSPACE is required");
const { createClock, createFailureStore, createTransport, createDeliveryWorkflow } = await import(pathToFileURL(join(workspace, "src/index.mjs")));

function workflow(outcomes, options = {}) {
  const clock = createClock();
  const failures = createFailureStore();
  const transport = createTransport(outcomes);
  const service = createDeliveryWorkflow({ transport, failures, clock, ...options });
  return { clock, failures, transport, service };
}

test("target workflow completes bounded retries and persists exhaustion", async () => {
  const { service, clock, failures, transport } = workflow([
    { ok: false, retryable: true },
    { ok: false, retryable: true },
    { ok: false, retryable: true },
  ], { maxAttempts: 3 });
  const result = await service.deliver({ id: "m-1", type: "invoice.ready" });
  assert.deepEqual(result, { eventId: "m-1", attempts: 3, status: "failed", error: "delivery failed" });
  assert.deepEqual(clock.waits(), [100, 200]);
  assert.equal(transport.sent().length, 0);
  assert.equal(failures.all().length, 1);
});

test("target workflow does not poison dedupe after failure", async () => {
  const clock = createClock();
  const failures = createFailureStore();
  const transport = createTransport([{ ok: false, retryable: false }, { ok: true }]);
  const service = createDeliveryWorkflow({ transport, failures, clock });
  const event = { id: "m-2", type: "invoice.ready", payload: { tenant: "a" } };
  assert.equal((await service.deliver(event)).status, "failed");
  assert.equal((await service.deliver(event)).status, "sent");
  assert.equal(transport.sent().length, 1);
});

test("successful delivery is idempotent and input remains unchanged", async () => {
  const { service, transport } = workflow([{ ok: true }, { ok: true }]);
  const event = { id: "m-3", type: "invoice.ready", payload: { amount: 42 } };
  const snapshot = structuredClone(event);
  const first = await service.deliver(event);
  const second = await service.deliver(event);
  assert.equal(first.status, "sent");
  assert.equal(second.duplicate, true);
  assert.equal(transport.sent().length, 1);
  assert.deepEqual(event, snapshot);
});

test("retryable failures eventually deliver and use exponential waits", async () => {
  const { service, clock, transport, failures } = workflow([
    { ok: false, retryable: true },
    { ok: false, retryable: true },
    { ok: true },
  ]);
  const result = await service.deliver({ id: "m-4", type: "invoice.ready" });
  assert.deepEqual(result, { eventId: "m-4", status: "sent", attempts: 3 });
  assert.deepEqual(clock.waits(), [100, 200]);
  assert.equal(transport.sent().length, 1);
  assert.equal(failures.all().length, 0);
});

test("permanent failures persist immediately without waiting", async () => {
  const { service, clock, failures, transport } = workflow([{ ok: false, retryable: false, message: "invalid destination" }]);
  const result = await service.deliver({ id: "m-5", type: "invoice.ready" });
  assert.deepEqual(result, { eventId: "m-5", attempts: 1, status: "failed", error: "invalid destination" });
  assert.deepEqual(clock.waits(), []);
  assert.equal(failures.all().length, 1);
  assert.equal(transport.sent().length, 0);
});

test("backoff is capped for large retry numbers", async () => {
  const { createBackoff } = await import(pathToFileURL(join(workspace, "src/backoff.mjs")));
  const backoff = createBackoff({ baseMs: 100, capMs: 250 });
  assert.equal(backoff.delay(1), 100);
  assert.equal(backoff.delay(2), 200);
  assert.equal(backoff.delay(3), 250);
  assert.equal(backoff.delay(20), 250);
});

test("persistence failure propagates without poisoning dedupe", async () => {
  let unavailable = true;
  const saved = [];
  const failures = {
    save(record) {
      if (unavailable) {
        unavailable = false;
        throw new Error("store unavailable");
      }
      saved.push(record);
    },
    all() {
      return saved.map((record) => ({ ...record }));
    },
  };
  const transport = createTransport([{ ok: false, retryable: false }, { ok: true }]);
  const service = createDeliveryWorkflow({ transport, failures, clock: createClock() });
  const event = { id: "m-6", type: "invoice.ready" };
  await assert.rejects(service.deliver(event), /store unavailable/);
  assert.equal((await service.deliver(event)).status, "sent");
  assert.equal(transport.sent().length, 1);
});

test("mutating transports cannot change the caller event", async () => {
  const event = { id: "m-7", type: "invoice.ready", payload: { amount: 42 } };
  const snapshot = structuredClone(event);
  const transport = {
    async send(received) {
      received.payload.amount = 0;
      return { accepted: true };
    },
    sent() {
      return [];
    },
  };
  const service = createDeliveryWorkflow({ transport, failures: createFailureStore(), clock: createClock() });
  await service.deliver(event);
  assert.deepEqual(event, snapshot);
});
