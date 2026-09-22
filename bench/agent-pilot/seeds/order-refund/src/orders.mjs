import { toCents } from "./money.mjs";

export function lineTotalCents(line) {
  if (!line || typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 1) throw new Error("invalid quantity");
  return toCents(line.unitPrice) * line.quantity;
}

export function orderTotalCents(order) {
  if (!order || !Array.isArray(order.lines) || order.lines.length === 0) throw new Error("invalid order");
  return order.lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}
