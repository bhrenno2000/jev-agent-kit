export function createInventorySystem(initial = {}) {
  const stock = new Map(Object.entries(initial));
  const reservations = new Map();
  const keys = new Map();
  const events = [];
  let tail = Promise.resolve();
  let failPersist = false;
  const identity = (...parts) => parts.map((part) => `${String(part).length}:${part}`).join("|");
  const id = (r) => identity(r.tenantId, r.idempotencyKey);
  const validate = (request) => {
    if (!request || typeof request !== "object") throw new Error("request required");
    for (const field of ["tenantId", "orderId", "sku", "idempotencyKey"])
      if (typeof request[field] !== "string" || request[field].length === 0)
        throw new Error("request required");
    if (!Number.isInteger(request.quantity) || request.quantity < 1)
      throw new Error("quantity required");
  };
  const fp = (r, op) =>
    JSON.stringify({ operation: op, orderId: r.orderId, sku: r.sku, quantity: r.quantity });
  const snapshot = () =>
    structuredClone({
      stock: Object.fromEntries(stock),
      reservations: Object.fromEntries(reservations),
      idempotency: Object.fromEntries(keys),
    });
  const restore = (before, count) => {
    stock.clear();
    for (const [name, value] of Object.entries(before.stock)) stock.set(name, value);
    reservations.clear();
    for (const [name, value] of Object.entries(before.reservations)) reservations.set(name, value);
    keys.clear();
    for (const [name, value] of Object.entries(before.idempotency)) keys.set(name, value);
    events.splice(count);
  };
  async function serial(work) {
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
  }
  async function operate(request, operation) {
    validate(request);
    request = structuredClone(request);
    return serial(async () => {
      const key = id(request);
      const fingerprint = fp(request, operation);
      const previous = keys.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("idempotency key payload conflict");
        return structuredClone(previous.result);
      }
      const before = snapshot();
      const eventCount = events.length;
      try {
        let result;
        if (operation === "reserve") {
          const item = `${request.tenantId}:${request.sku}`;
          if (reservations.has(identity(request.tenantId, request.orderId)))
            throw new Error("order already reserved");
          if ((stock.get(item) ?? 0) < request.quantity) throw new Error("insufficient stock");
          stock.set(item, stock.get(item) - request.quantity);
          result = {
            tenantId: request.tenantId,
            orderId: request.orderId,
            sku: request.sku,
            quantity: request.quantity,
            status: "reserved",
          };
          reservations.set(identity(request.tenantId, request.orderId), result);
          events.push({ type: "inventory.reserved", ...result });
        } else {
          const reservation = reservations.get(identity(request.tenantId, request.orderId));
          if (
            !reservation ||
            reservation.sku !== request.sku ||
            reservation.quantity !== request.quantity
          )
            throw new Error("reservation mismatch");
          const alreadyCheckedOut = reservation.status === "checked_out";
          reservation.status = "checked_out";
          result = { ...reservation };
          if (!alreadyCheckedOut) events.push({ type: "inventory.checked_out", ...result });
        }
        if (failPersist) {
          failPersist = false;
          throw new Error("persist failed");
        }
        keys.set(key, { fingerprint, result: structuredClone(result) });
        return structuredClone(result);
      } catch (error) {
        restore(before, eventCount);
        throw error;
      }
    });
  }
  return {
    reserve: (request) => operate(request, "reserve"),
    checkout: (request) => operate(request, "checkout"),
    snapshot,
    events: () => structuredClone(events),
    faults: {
      failNext(name) {
        if (name === "persist") failPersist = true;
      },
    },
  };
}
