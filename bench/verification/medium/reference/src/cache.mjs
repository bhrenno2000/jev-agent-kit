import { cacheKey } from "./keys.mjs";

export function createCache({ clock }) {
  const entries = new Map();
  const inflight = new Map();
  const now = () => {
    const value = clock.now();
    if (!Number.isFinite(value)) throw new Error("clock required");
    return value;
  };
  return {
    async get(scope, key, loader, ttlMs) {
      if (typeof loader !== "function") throw new Error("loader required");
      if (!Number.isInteger(ttlMs) || ttlMs < 0) throw new Error("ttl required");
      const id = cacheKey(scope, key);
      const current = entries.get(id);
      if (current && now() < current.expiresAt) return current.value;
      if (inflight.has(id)) return inflight.get(id);
      const pending = Promise.resolve()
        .then(loader)
        .then((value) => {
          entries.set(id, { value, expiresAt: now() + ttlMs });
          return value;
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, pending);
      return pending;
    },
    clear(scope, key) {
      entries.delete(cacheKey(scope, key));
    },
    size() {
      return entries.size;
    },
  };
}
