import { clone } from "./clone.mjs";

export async function transaction(persistence, store, outbox, work) {
  const before = persistence.snapshot();
  const events = persistence.events();
  const draft = clone(before);
  const result = await work(draft);
  try {
    await persistence.commit(draft, [...events, ...(result.events ?? [])]);
    return result.value;
  } catch (error) {
    throw error;
  }
}
