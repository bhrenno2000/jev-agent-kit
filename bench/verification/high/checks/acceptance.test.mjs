import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const root = process.env.BENCH_WORKSPACE;
if (!root) throw new Error("BENCH_WORKSPACE is required");
const { createIngestionSystem } = await import(pathToFileURL(join(root, "src/index.mjs")));

test("partition and event identities remain independent when identifiers contain separators", async () => {
  const system = createIngestionSystem();
  await system.ingest([
    { partition: "a:b", offset: 1, id: "same", payload: { side: "left" } },
    { partition: "a", offset: 1, id: "same", payload: { side: "right" } },
  ]);
  assert.equal(system.outbox().length, 2);
  assert.equal(Object.keys(system.snapshot().events).length, 2);
});

test("partition and event identities remain independent when identifiers contain NUL characters", async () => {
  const system = createIngestionSystem();
  await system.ingest([
    { partition: "a", offset: 1, id: "\u0000b", payload: { side: "left" } },
    { partition: "a\u0000", offset: 1, id: "b", payload: { side: "right" } },
  ]);
  assert.equal(Object.keys(system.snapshot().events).length, 2);
  assert.equal(system.outbox().length, 2);
});

test("checkpoints retain the maximum accepted offset for out of order events", async () => {
  const system = createIngestionSystem();
  await system.ingest([
    { partition: "orders", offset: 8, id: "eight", payload: {} },
    { partition: "orders", offset: 3, id: "three", payload: {} },
  ]);
  assert.equal(system.checkpoint("orders"), 8);
  assert.equal(Object.keys(system.snapshot().events).length, 2);
});

test("concurrent batches preserve every partition event and checkpoint", async () => {
  const system = createIngestionSystem();
  await Promise.all([
    system.ingest([
      { partition: "left", offset: 1, id: "one", payload: {} },
      { partition: "left", offset: 2, id: "two", payload: {} },
    ]),
    system.ingest([
      { partition: "right", offset: 1, id: "one", payload: {} },
      { partition: "right", offset: 2, id: "two", payload: {} },
    ]),
  ]);
  assert.equal(Object.keys(system.snapshot().events).length, 4);
  assert.equal(system.checkpoint("left"), 2);
  assert.equal(system.checkpoint("right"), 2);
  assert.equal(system.outbox().length, 4);
});

test("concurrent batches on one partition preserve both accepted events", async () => {
  const system = createIngestionSystem();
  await Promise.all([
    system.ingest([{ partition: "shared", offset: 1, id: "one", payload: {} }]),
    system.ingest([{ partition: "shared", offset: 2, id: "two", payload: {} }]),
  ]);
  assert.equal(Object.keys(system.snapshot().events).length, 2);
  assert.equal(system.checkpoint("shared"), 2);
  assert.equal(system.outbox().length, 2);
});

test("same partition event retries are deduplicated", async () => {
  const system = createIngestionSystem();
  const event = { partition: "orders", offset: 4, id: "event-4", payload: { value: 1 } };
  await system.ingest([event]);
  await system.ingest([event]);
  assert.equal(Object.keys(system.snapshot().events).length, 1);
  assert.equal(system.outbox().length, 1);
});

test("persistence failure leaves events, checkpoints, and outbox unchanged", async () => {
  const system = createIngestionSystem();
  await system.ingest([{ partition: "orders", offset: 1, id: "event-1", payload: {} }]);
  const before = structuredClone(system.snapshot());
  const outboxBefore = structuredClone(system.outbox());
  system.faults.failNext("persist");
  await assert.rejects(() =>
    system.ingest([{ partition: "orders", offset: 2, id: "event-2", payload: {} }]),
  );
  assert.deepEqual(system.snapshot(), before);
  assert.deepEqual(system.outbox(), outboxBefore);
});

test("a failed batch can be retried after persistence recovers", async () => {
  const system = createIngestionSystem();
  const batch = [{ partition: "orders", offset: 2, id: "event-2", payload: { value: 2 } }];
  system.faults.failNext("persist");
  await assert.rejects(() => system.ingest(batch));
  await system.ingest(batch);
  assert.equal(Object.keys(system.snapshot().events).length, 1);
  assert.equal(system.outbox().length, 1);
});

test("stored payloads and returned data do not alias caller objects", async () => {
  const system = createIngestionSystem();
  const payload = { nested: { value: 1 } };
  const event = { partition: "orders", offset: 1, id: "event-1", payload };
  const returned = await system.ingest([event]);
  payload.nested.value = 9;
  event.id = "changed";
  const returnedKey = Object.keys(returned.events)[0];
  returned.events[returnedKey].payload.nested.value = 7;
  const snapshot = system.snapshot();
  const storedKey = Object.keys(snapshot.events)[0];
  assert.equal(snapshot.events[storedKey].payload.nested.value, 1);
  assert.equal(system.outbox()[0].id, "event-1");
});

test("the service owns the batch before asynchronous queueing", async () => {
  const system = createIngestionSystem();
  const batch = [{ partition: "orders", offset: 1, id: "event-1", payload: { value: 1 } }];
  const pending = system.ingest(batch);
  batch[0].payload.value = 99;
  batch[0].id = "changed";
  await pending;
  const snapshot = system.snapshot();
  const key = Object.keys(snapshot.events)[0];
  assert.equal(snapshot.events[key].id, "event-1");
  assert.equal(snapshot.events[key].payload.value, 1);
});

test("empty and invalid batches reject without mutation", async () => {
  const system = createIngestionSystem();
  const before = system.snapshot();
  await assert.rejects(() => system.ingest([]));
  await assert.rejects(() => system.ingest([{ partition: "", offset: 1, id: "x", payload: {} }]));
  await assert.rejects(() =>
    system.ingest([{ partition: "orders", offset: -1, id: "x", payload: {} }]),
  );
  assert.deepEqual(system.snapshot(), before);
  assert.deepEqual(system.outbox(), []);
});
