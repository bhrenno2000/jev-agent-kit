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
  const generations = new Map();
  return {
    async get(key, loader) {
      validateRequest(key, loader);
      const old = entries.get(key);
      if (isFresh(old, now())) return old.promise ?? old.value;
      const generation = Math.max(nextGeneration(old), (generations.get(key) ?? 0) + 1);
      generations.set(key, generation);
      const promise = Promise.resolve().then(loader);
      entries.set(key, pendingEntry(promise, generation));
      let value;
      try {
        value = await promise;
      } catch (error) {
        if (entries.get(key)?.generation === generation) entries.delete(key);
        throw error;
      }
      if (entries.get(key)?.generation === generation)
        entries.set(key, valueEntry(value, generation, now() + ttlMs));
      return value;
    },
    invalidate(key) {
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    size() {
      const time = now();
      for (const [key, entry] of entries) if (!isFresh(entry, time)) entries.delete(key);
      return entries.size;
    },
  };
}
