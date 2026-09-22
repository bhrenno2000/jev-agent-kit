import { createClock } from "./clock.mjs";
import { ConflictError } from "./errors.mjs";
import { checkoutEvent, reservationEvent } from "./events.mjs";
import { idempotencyKey, lookup } from "./idempotency.mjs";
import { reserveStock, requireReservation } from "./inventory.mjs";
import { reservationKey, createReservation } from "./reservations.mjs";
import { transaction } from "./transaction.mjs";
import { assertRequest } from "./validator.mjs";

export function createInventoryService({
  store,
  persistence,
  outbox,
  lock,
  clock = createClock(),
}) {
  async function reserve(request) {
    assertRequest(request);
    request.operation = "reserve";
    const previous = lookup(store, request);
    if (previous) return previous;
    return transaction(persistence, store, outbox, async () => {
      const available = store.stock(request.tenantId, request.sku);
      await Promise.resolve();
      if (available < request.quantity) throw new ConflictError("insufficient stock");
      store.setStock(request.tenantId, request.sku, available - request.quantity);
      const reservation = createReservation(request, clock);
      store.reservations.set(reservationKey(request), reservation);
      const result = { ...reservation };
      store.idempotency.set(idempotencyKey(request), {
        fingerprint: JSON.stringify({
          orderId: request.orderId,
          sku: request.sku,
          quantity: request.quantity,
          operation: request.operation,
        }),
        result,
      });
      return { value: result, events: [reservationEvent(reservation)] };
    });
  }

  async function checkout(request) {
    assertRequest({ ...request, quantity: 1 });
    request.operation = "checkout";
    const previous = lookup(store, request);
    if (previous) return previous;
    return transaction(persistence, store, outbox, async () => {
      const reservation = requireReservation(store, request);
      if (reservation.status === "checked_out") return { value: reservation, events: [] };
      reservation.status = "checked_out";
      const result = { ...reservation };
      store.idempotency.set(idempotencyKey(request), {
        fingerprint: JSON.stringify({
          orderId: request.orderId,
          sku: request.sku,
          quantity: request.quantity,
          operation: request.operation,
        }),
        result,
      });
      return { value: result, events: [checkoutEvent(reservation)] };
    });
  }

  return {
    reserve,
    checkout,
    snapshot: () => persistence.snapshot(),
    events: () => persistence.events(),
  };
}
