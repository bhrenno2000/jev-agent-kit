import { createFaults } from "./faults.mjs";
import { eventKey, checkpointKey } from "./keys.mjs";
import { createStore } from "./store.mjs";
import { commitBatch } from "./transaction.mjs";
import { validateBatch } from "./validate.mjs";
import { createLock } from "./lock.mjs";

export function createIngestionSystem(initial = {}) {
  const store = createStore(initial);
  const faults = createFaults();
  const withLock = createLock();
  const keys = { eventKey, checkpointKey };
  return {
    async ingest(batch) {
      validateBatch(batch);
      const ownedBatch = structuredClone(batch);
      return withLock(() => commitBatch(store, ownedBatch, keys, faults));
    },
    snapshot: () => store.snapshot(),
    outbox: () => store.outbox.map((item) => structuredClone(item)),
    checkpoint: (partition) => store.checkpoints.get(checkpointKey(partition)),
    faults,
  };
}
