export function validateBatch(batch) {
  if (!Array.isArray(batch) || batch.length === 0) throw new Error("batch required");
  for (const event of batch) {
    if (
      !event ||
      typeof event.partition !== "string" ||
      !event.partition ||
      typeof event.id !== "string" ||
      !event.id ||
      !Number.isInteger(event.offset) ||
      event.offset < 0
    )
      throw new Error("invalid event");
  }
}
