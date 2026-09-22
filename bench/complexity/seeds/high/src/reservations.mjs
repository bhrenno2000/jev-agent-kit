import { tenantKey } from "./tenant.mjs";

export function reservationKey(request) {
  return tenantKey(request.tenantId, request.orderId);
}

export function createReservation(request, clock) {
  return {
    tenantId: request.tenantId,
    orderId: request.orderId,
    sku: request.sku,
    quantity: request.quantity,
    status: "reserved",
    createdAt: clock.now(),
  };
}
