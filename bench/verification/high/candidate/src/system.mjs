import { createFaults } from "./faults.mjs";
import { eventKey, checkpointKey } from "./keys.mjs";
import { createStore } from "./store.mjs";
import { commitBatch } from "./transaction.mjs";
import { validateBatch } from "./validate.mjs";

export function createIngestionSystem(initial = {}) {
  const store = createStore(initial);
  const faults = createFaults();
  const keys = { eventKey, checkpointKey };
  return {
    async ingest(batch) {
      validateBatch(batch);
      const ownedBatch = structuredClone(batch);
      return commitBatch(store, ownedBatch, keys, faults);
    },
    snapshot: () => store.snapshot(),
    outbox: () => store.outbox.map((item) => structuredClone(item)),
    checkpoint: (partition) => store.checkpoints.get(checkpointKey(partition)),
    faults,
  };
}
