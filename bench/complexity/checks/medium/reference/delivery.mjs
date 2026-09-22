import { createBackoff } from "./backoff.mjs";

export function createDeliveryWorkflow({ transport, failures, clock, maxAttempts = 3, backoff = createBackoff(), dedupe: suppliedDedupe }) {
  const dedupe = suppliedDedupe ?? {
    values: new Map(),
    get(id) { return this.values.get(id); },
    set(id, value) { this.values.set(id, { ...value }); },
  };
  return {
    async deliver(event) {
      if (!event?.id || !event.type) throw new Error("invalid event");
      const previous = dedupe.get(event.id);
      if (previous) return { ...previous, duplicate: true };
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await transport.send(structuredClone(event));
          const result = { eventId: event.id, status: "sent", attempts: attempt };
          dedupe.set(event.id, result);
          return result;
        } catch (error) {
          if (!error.retryable || attempt === maxAttempts) {
            const failed = { eventId: event.id, attempts: attempt, status: "failed", error: error.message };
            failures.save(failed);
            return failed;
          }
          await clock.sleep(backoff.delay(attempt));
        }
      }
      throw new Error("unreachable");
    },
  };
}
