export function attemptRecord(event, attempts, status, error) {
  return { eventId: event.id, attempts, status, ...(error ? { error: error.message } : {}) };
}
