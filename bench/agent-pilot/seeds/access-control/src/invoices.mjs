const invoices = new Map([
  ["inv-1", { id: "inv-1", tenantId: "tenant-a", status: "open", total: 1200 }],
  ["inv-2", { id: "inv-2", tenantId: "tenant-b", status: "open", total: 450 }],
  ["inv-3", { id: "inv-3", tenantId: "tenant-a", status: "deleted", total: 90 }],
]);

export function findInvoice(id) {
  return invoices.get(id) ?? null;
}
