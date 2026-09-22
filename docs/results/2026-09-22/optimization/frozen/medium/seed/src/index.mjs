import { validateRequest } from "./validate-request.mjs";
import { pendingEntry, valueEntry } from "./entry-state.mjs";
import { nextGeneration } from "./generation.mjs";
import { isFresh } from "./cache-operations.mjs";
export function createRequestCache({ clock = () => Date.now(), ttlMs = 1000 } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 0) throw new Error("invalid ttl");
  let lastClock = -Infinity;
  const now = () => {
    const value = clock();
    if (!Number.isFinite(value) || value < lastClock) throw new Error("invalid clock");
    lastClock = value;
    return value;
  };
  const entries = new Map();
  return {
    async get(key, loader) {
      validateRequest(key, loader);
      const old = entries.get(key);
      if (isFresh(old, now())) return old.promise ?? old.value;
      const generation = nextGeneration(old);
      const promise = Promise.resolve().then(loader);
      entries.set(key, pendingEntry(promise, generation));
      const value = await promise;
      entries.set(key, valueEntry(value, generation, now() + ttlMs));
      return value;
    },
    invalidate(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
