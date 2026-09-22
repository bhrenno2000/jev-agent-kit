export function createInventorySystem(initial = {}) {
  const stock = new Map(Object.entries(initial));
  const reservations = new Map();
  const idempotency = new Map();
  const events = [];
  let tail = Promise.resolve();
  const faults = {
    next: false,
    failNext(name) {
      if (name === "persist") this.next = true;
    },
  };
  const key = (r) => `${r.tenantId}:${r.idempotencyKey}`;
  const fingerprint = (r, operation) =>
    JSON.stringify({ operation, orderId: r.orderId, sku: r.sku, quantity: r.quantity });
  const serial = async (work) => {
    const prior = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await work();
    } finally {
      release();
    }
  };
  const snapshot = () => ({
    stock: Object.fromEntries(stock),
    reservations: Object.fromEntries(reservations),
    idempotency: Object.fromEntries(idempotency),
  });
  const restore = (before, eventCount) => {
    stock.clear();
    for (const [k, v] of Object.entries(before.stock)) stock.set(k, v);
    reservations.clear();
    for (const [k, v] of Object.entries(before.reservations)) reservations.set(k, v);
    idempotency.clear();
    for (const [k, v] of Object.entries(before.idempotency)) idempotency.set(k, v);
    events.splice(eventCount);
  };
  const operation = async (request, kind) =>
    serial(async () => {
      const existing = idempotency.get(key(request));
      const expected = fingerprint(request, kind);
      if (existing) {
        if (existing.fingerprint !== expected) throw new Error("idempotency key payload conflict");
        return structuredClone(existing.result);
      }
      const before = snapshot();
      const eventCount = events.length;
      const item = `${request.tenantId}:${request.sku}`;
      if (kind === "reserve") {
        if ((stock.get(item) ?? 0) < request.quantity) throw new Error("insufficient stock");
        stock.set(item, stock.get(item) - request.quantity);
        const reservation = {
          tenantId: request.tenantId,
          orderId: request.orderId,
          sku: request.sku,
          quantity: request.quantity,
          status: "reserved",
          createdAt: Date.now(),
        };
        reservations.set(`${request.tenantId}:${request.orderId}`, reservation);
        idempotency.set(key(request), { fingerprint: expected, result: reservation });
        events.push({
          type: "inventory.reserved",
          tenantId: request.tenantId,
          orderId: request.orderId,
          sku: request.sku,
          quantity: request.quantity,
        });
      } else {
        const reservation = reservations.get(`${request.tenantId}:${request.orderId}`);
        if (!reservation) throw new Error("reservation not found");
        reservation.status = "checked_out";
        idempotency.set(key(request), { fingerprint: expected, result: reservation });
        events.push({
          type: "inventory.checked_out",
          tenantId: request.tenantId,
          orderId: request.orderId,
          sku: request.sku,
          quantity: request.quantity,
        });
      }
      try {
        if (faults.next) {
          faults.next = false;
          throw new Error("persist failed");
        }
        return structuredClone(idempotency.get(key(request)).result);
      } catch (error) {
        restore(before, eventCount);
        throw error;
      }
    });
  return {
    reserve: (request) => operation(request, "reserve"),
    checkout: (request) => operation(request, "checkout"),
    snapshot,
    events: () => structuredClone(events),
    faults,
  };
}
