import { createBackoff } from "./backoff.mjs";
import { createDedupe } from "./dedupe.mjs";
import { attemptRecord } from "./attempts.mjs";

export function createDeliveryWorkflow({ transport, failures, clock, maxAttempts = 3, backoff = createBackoff(), dedupe = createDedupe() }) {
  return {
    async deliver(event) {
      if (!event?.id || !event.type) throw new Error("invalid event");
      const previous = dedupe.get(event.id);
      if (previous) return { ...previous, duplicate: true };
      for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
        try {
          await transport.send(structuredClone(event));
          const result = { eventId: event.id, status: "sent", attempts: attempt };
          dedupe.set(event.id, result);
          return result;
        } catch (error) {
          if (!error.retryable) {
            const failed = attemptRecord(event, attempt, "failed", error);
            failures.save(failed);
            return failed;
          }
          await clock.sleep(backoff.delay(attempt));
        }
      }
      return { eventId: event.id, status: "unknown" };
    },
  };
}
