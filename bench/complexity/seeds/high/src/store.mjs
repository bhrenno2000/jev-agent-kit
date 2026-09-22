import { clone } from "./clone.mjs";
import { tenantKey } from "./tenant.mjs";

export function createStore(initial = {}) {
  const state = {
    stock: new Map(Object.entries(initial)),
    reservations: new Map(),
    idempotency: new Map(),
  };
  return {
    snapshot() {
      return clone({
        stock: Object.fromEntries(state.stock),
        reservations: Object.fromEntries(state.reservations),
        idempotency: Object.fromEntries(state.idempotency),
      });
    },
    stock(tenantId, sku) {
      return state.stock.get(tenantKey(tenantId, sku)) ?? 0;
    },
    setStock(tenantId, sku, quantity) {
      state.stock.set(tenantKey(tenantId, sku), quantity);
    },
    reservations: state.reservations,
    idempotency: state.idempotency,
    state,
  };
}
