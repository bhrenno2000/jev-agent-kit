import { identity } from "./identity.mjs";
import { positive } from "./validate.mjs";
import { fingerprint } from "./fingerprint.mjs";
export const stockKey = (tenant, sku) => identity(tenant, sku);
export const orderKey = (tenant, key) => JSON.stringify([tenant, key]);
export const requestFingerprint = (request) =>
  fingerprint([request.orderId, request.sku, request.quantity, request.payload ?? null]);
export function validPayload(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) return false;
  }
  seen.add(value);
  const valid = Object.values(value).every((item) => validPayload(item, seen));
  seen.delete(value);
  return valid;
}
export function validRequest(request) {
  return Boolean(
    request &&
    !Array.isArray(request) &&
    typeof request.tenantId === "string" &&
    request.tenantId &&
    typeof request.orderId === "string" &&
    request.orderId &&
    typeof request.sku === "string" &&
    request.sku &&
    positive(request.quantity) &&
    typeof request.idempotencyKey === "string" &&
    request.idempotencyKey &&
    validPayload(request.payload ?? null),
  );
}
