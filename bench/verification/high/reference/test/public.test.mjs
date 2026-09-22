import assert from "node:assert/strict";
import { test } from "node:test";
import { createIngestionSystem } from "../src/index.mjs";

test("accepts a batch and exposes its checkpoint", async () => {
  const system = createIngestionSystem();
  await system.ingest([{ partition: "orders", offset: 1, id: "one", payload: { value: 1 } }]);
  assert.equal(system.checkpoint("orders"), 1);
  assert.equal(system.outbox().length, 1);
});

test("repeating an identical event does not add another record", async () => {
  const system = createIngestionSystem();
  const event = { partition: "orders", offset: 1, id: "one", payload: { value: 1 } };
  await system.ingest([event]);
  await system.ingest([event]);
  assert.equal(system.outbox().length, 1);
});
