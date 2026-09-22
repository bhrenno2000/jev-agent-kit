import { clone } from "./clone.mjs";
import { tenantKey } from "./tenant.mjs";
import { ConflictError } from "./errors.mjs";

export function idempotencyKey(request) {
  return request.idempotencyKey;
}

export function lookup(store, request) {
  const previous = store.idempotency.get(idempotencyKey(request));
  if (!previous) return null;
  if (
    previous.fingerprint !==
    JSON.stringify({
      orderId: request.orderId,
      sku: request.sku,
      quantity: request.quantity,
      operation: request.operation,
    })
  )
    throw new ConflictError("idempotency key payload conflict");
  return clone(previous.result);
}
