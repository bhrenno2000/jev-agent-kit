import assert from "node:assert/strict";
import { test } from "node:test";
import { createClock, createDeliveryWorkflow, createFailureStore, createTransport } from "../src/index.mjs";

test("delivers a successful event once", async () => {
  const transport = createTransport([{ ok: true }]);
  const service = createDeliveryWorkflow({ transport, failures: createFailureStore(), clock: createClock() });
  assert.deepEqual(await service.deliver({ id: "evt-1", type: "invoice.ready", payload: { id: "i-1" } }), { eventId: "evt-1", status: "sent", attempts: 1 });
  assert.equal(transport.sent().length, 1);
});

test("retries a transient failure and persists a permanent failure", async () => {
  const clock = createClock();
  const failures = createFailureStore();
  const transport = createTransport([{ ok: false, retryable: true }, { ok: false, retryable: false }]);
  const service = createDeliveryWorkflow({ transport, failures, clock, maxAttempts: 3 });
  const result = await service.deliver({ id: "evt-2", type: "invoice.ready" });
  assert.equal(result.status, "failed");
  assert.deepEqual(clock.waits(), [100]);
  assert.equal(failures.all().length, 1);
});

test("persists an event after the retry budget is exhausted", async () => {
  const failures = createFailureStore();
  const transport = createTransport([{ ok: false, retryable: true }, { ok: false, retryable: true }, { ok: false, retryable: true }]);
  const service = createDeliveryWorkflow({ transport, failures, clock: createClock(), maxAttempts: 3 });
  const result = await service.deliver({ id: "evt-3", type: "invoice.ready" });
  assert.equal(result.status, "failed");
  assert.equal(result.attempts, 3);
  assert.equal(failures.all().length, 1);
});
