export function createTransport(outcomes) {
  let index = 0;
  const sent = [];
  return {
    async send(event) {
      const outcome = outcomes[index++] ?? { ok: true };
      if (!outcome.ok) {
        const error = new Error(outcome.message ?? "delivery failed");
        error.retryable = outcome.retryable === true;
        throw error;
      }
      sent.push({ ...event });
      return { accepted: true };
    },
    sent() {
      return sent.map((event) => ({ ...event }));
    },
  };
}
