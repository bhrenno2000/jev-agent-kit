import { clone } from "./clone.mjs";

export async function commitBatch(store, batch, keys, faults) {
  const draft = {
    events: new Map(store.events),
    checkpoints: new Map(store.checkpoints),
    outbox: clone(store.outbox),
  };
  for (const event of batch) {
    const key = keys.eventKey(event.partition, event.id);
    if (draft.events.has(key)) continue;
    draft.events.set(key, clone(event));
    draft.outbox.push({
      type: "event.accepted",
      partition: event.partition,
      id: event.id,
      offset: event.offset,
    });
    const checkpoint = draft.checkpoints.get(keys.checkpointKey(event.partition));
    draft.checkpoints.set(
      keys.checkpointKey(event.partition),
      checkpoint === undefined ? event.offset : Math.max(checkpoint, event.offset),
    );
  }
  await Promise.resolve();
  faults.consume("persist");
  store.events = draft.events;
  store.checkpoints = draft.checkpoints;
  store.outbox = draft.outbox;
  return store.snapshot();
}
