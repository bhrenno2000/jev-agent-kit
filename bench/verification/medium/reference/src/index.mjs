import { createClock } from "./clock.mjs";
import { createCache } from "./cache.mjs";

export function createKeyedCache(options = {}) {
  if (options.clock !== undefined && (!options.clock || typeof options.clock.now !== "function"))
    throw new Error("clock required");
  const clock = options.clock ?? createClock();
  return createCache({ clock });
}
