export function taxCents(subtotalCents, rate) {
  if (!Number.isInteger(subtotalCents) || typeof rate !== "number" || rate < 0) throw new Error("invalid tax");
  return Math.round(subtotalCents * rate);
}
