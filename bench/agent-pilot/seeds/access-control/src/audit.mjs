export function createAuditLog() {
  const events = [];
  return {
    append(event) {
      events.push({ ...event });
    },
    events() {
      return events.map((event) => ({ ...event }));
    },
  };
}
