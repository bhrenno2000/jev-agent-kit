import { fromCents } from "./money.mjs";
import { lineTotalCents, orderTotalCents } from "./orders.mjs";

export function createRefundService({ ledger }) {
  if (!ledger) throw new Error("ledger required");
  const refundedByOrder = new Map();
  return {
    refund(order, request) {
      if (!order?.id || !request?.requestId) throw new Error("request required");
      const lines = request.lineIds ?? order.lines.map((line) => line.id);
      if (!Array.isArray(lines) || lines.length === 0) throw new Error("lines required");
      const selected = order.lines.filter((line) => lines.includes(line.id));
      if (selected.length !== lines.length) throw new Error("unknown line");
      const amountCents = selected.reduce((sum, line) => sum + lineTotalCents(line), 0);
      if (amountCents > orderTotalCents(order)) throw new Error("amount exceeds order");
      const previous = refundedByOrder.get(order.id) ?? 0;
      if (previous + amountCents > orderTotalCents(order)) throw new Error("order already refunded");
      const result = { requestId: request.requestId, orderId: order.id, amount: fromCents(amountCents), amountCents };
      refundedByOrder.set(order.id, previous + amountCents);
      ledger.record(result);
      return result;
    },
  };
}
