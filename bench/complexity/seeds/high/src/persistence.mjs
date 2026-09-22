import { clone } from "./clone.mjs";

export function createPersistence(store, outbox, faults) {
  return {
    async commit(snapshot, events) {
      await Promise.resolve();
      faults.consume("persist");
      store.state.stock = new Map(Object.entries(snapshot.stock));
      store.state.reservations = new Map(Object.entries(snapshot.reservations));
      store.state.idempotency = new Map(Object.entries(snapshot.idempotency));
      outbox.replace(events);
    },
    snapshot() {
      return {
        stock: Object.fromEntries(store.state.stock),
        reservations: Object.fromEntries(store.state.reservations),
        idempotency: Object.fromEntries(store.state.idempotency),
      };
    },
    events() {
      return clone(outbox.all());
    },
  };
}
