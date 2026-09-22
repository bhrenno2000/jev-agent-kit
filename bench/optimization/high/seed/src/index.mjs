import { stockKey, orderKey, requestFingerprint, validRequest } from "./checkout-helpers.mjs";
import { copy } from "./clone.mjs";
import { serialQueue } from "./queue.mjs";
import { makeStore } from "./store.mjs";
export function createCheckout(initial = {}) {
  const tenantNames = Object.keys(initial);
  const stock = makeStore(
    Object.entries(initial).flatMap(([tenant, items]) =>
      Object.entries(items).map(([sku, count]) => {
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid inventory");
        return [stockKey(tenant, sku), count];
      }),
    ),
  );
  const orders = makeStore();
  let failPersistence = false;
  const run = serialQueue();
  return {
    checkout(request) {
      if (!validRequest(request)) return Promise.reject(new Error("invalid request"));
      const captured = request;
      return run(async () => {
        const keyForOrder = orderKey(captured.tenantId, captured.idempotencyKey);
        const old = orders.get(keyForOrder);
        const fingerprint = requestFingerprint(captured);
        if (old) {
          if (old.fingerprint !== fingerprint) throw new Error("idempotency conflict");
          return structuredClone(old.result);
        }
        const key = stockKey(captured.tenantId, captured.sku);
        const available = stock.get(key) ?? 0;
        if (available < captured.quantity) throw new Error("insufficient stock");
        const previous = stock.get(key);
        stock.set(key, available - captured.quantity);
        if (failPersistence) {
          failPersistence = false;
          stock.set(key, previous);
          throw new Error("persistence failure");
        }
        const result = {
          tenantId: captured.tenantId,
          orderId: captured.orderId,
          sku: captured.sku,
          quantity: captured.quantity,
          payload: structuredClone(captured.payload),
          status: "confirmed",
        };
        orders.set(keyForOrder, { fingerprint, result });
        return structuredClone(result);
      });
    },
    failNextPersistence() {
      failPersistence = true;
    },
    snapshot() {
      const grouped = new Map(tenantNames.map((tenant) => [tenant, new Map()]));
      for (const [key, count] of stock) {
        const separator = key.lastIndexOf(":");
        const tenant = key.slice(0, separator);
        const sku = key.slice(separator + 1);
        if (!grouped.has(tenant)) grouped.set(tenant, new Map());
        grouped.get(tenant).set(sku, count);
      }
      return copy({
        stock: Object.fromEntries(
          [...grouped].map(([tenant, items]) => [tenant, Object.fromEntries(items)]),
        ),
        orders: [...orders.values()].map((entry) => entry.result),
      });
    },
  };
}
