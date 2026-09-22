import { ConflictError, NotFoundError } from "./errors.mjs";

export function reserveStock(store, request) {
  const available = store.stock(request.tenantId, request.sku);
  if (available < request.quantity) throw new ConflictError("insufficient stock");
  store.setStock(request.tenantId, request.sku, available - request.quantity);
}

export function requireReservation(store, request) {
  const reservation = store.reservations.get(`${request.tenantId}:${request.orderId}`);
  if (!reservation) throw new NotFoundError("reservation not found");
  return reservation;
}
