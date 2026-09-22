import { clone } from "./clone.mjs";

export function createOutbox() {
  const events = [];
  return {
    append(event) {
      events.push(clone(event));
    },
    all() {
      return clone(events);
    },
    replace(next) {
      events.splice(0, events.length, ...clone(next));
    },
  };
}
