export function reservationEvent(reservation) {
  return {
    type: "inventory.reserved",
    tenantId: reservation.tenantId,
    orderId: reservation.orderId,
    sku: reservation.sku,
    quantity: reservation.quantity,
  };
}

export function checkoutEvent(reservation) {
  return {
    type: "inventory.checked_out",
    tenantId: reservation.tenantId,
    orderId: reservation.orderId,
    sku: reservation.sku,
    quantity: reservation.quantity,
  };
}
