import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuditLog, createInvoiceAccess } from "../src/index.mjs";

const actor = { id: "user-1", tenantId: "tenant-a", role: "billing_admin", active: true };

test("same-tenant billing admins can read an invoice", () => {
  const audit = createAuditLog();
  const result = createInvoiceAccess({ audit }).read(actor, "inv-1");
  assert.equal(result.id, "inv-1");
  assert.equal(audit.events().length, 1);
});

test("cross-tenant invoice reads are denied", () => {
  assert.throws(() => createInvoiceAccess().read(actor, "inv-2"), /denied/);
});
