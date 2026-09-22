import { clone } from "./clone.mjs";

export function createStore(initial = {}) {
  return {
    events: new Map(),
    checkpoints: new Map(Object.entries(initial.checkpoints ?? {})),
    outbox: [],
    snapshot() {
      return clone({
        events: Object.fromEntries(this.events),
        checkpoints: Object.fromEntries(this.checkpoints),
        outbox: this.outbox,
      });
    },
  };
}
