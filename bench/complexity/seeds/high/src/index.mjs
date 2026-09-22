import { createFaults } from "./faults.mjs";
import { createLock } from "./lock.mjs";
import { createOutbox } from "./outbox.mjs";
import { createPersistence } from "./persistence.mjs";
import { createStore } from "./store.mjs";
import { createInventoryService } from "./service.mjs";

export function createInventorySystem(initial = {}) {
  const store = createStore(initial);
  const outbox = createOutbox();
  const faults = createFaults();
  const persistence = createPersistence(store, outbox, faults);
  const service = createInventoryService({ store, persistence, outbox, lock: createLock() });
  return { ...service, store, outbox, faults };
}
