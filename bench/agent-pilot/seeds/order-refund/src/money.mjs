export function toCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("invalid money");
  return Math.round((value + Number.EPSILON) * 100);
}

export function fromCents(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error("invalid cents");
  return value / 100;
}
