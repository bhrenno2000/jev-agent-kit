export function assertRequest(request) {
  if (!request?.tenantId || !request.orderId || !request.sku || !request.idempotencyKey)
    throw new Error("request required");
  if (!Number.isInteger(request.quantity) || request.quantity < 1)
    throw new Error("quantity required");
}
