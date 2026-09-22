import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuditLog, createInvoiceAccess } from "../../seeds/access-control/src/index.mjs";

test("tenant boundary applies to every permitted role", () => {
  const service = createInvoiceAccess();
  for (const role of ["billing_admin", "support_agent"]) {
    const actor = { id: `u-${role}`, tenantId: "tenant-a", role, active: true };
    assert.throws(() => service.read(actor, "inv-2"), /denied/);
    assert.equal(service.read(actor, "inv-1").tenantId, "tenant-a");
  }
});

test("inactive and unknown roles cannot bypass tenant checks", () => {
  const service = createInvoiceAccess();
  assert.throws(() => service.read({ id: "u", tenantId: "tenant-a", role: "owner", active: true }, "inv-1"));
  assert.throws(() => service.read({ id: "u", tenantId: "tenant-a", role: "billing_admin", active: false }, "inv-1"));
  assert.throws(() => service.read({ id: "u", tenantId: "tenant-a", role: "billing_admin", active: true }, "inv-3"));
});

test("only successful reads create audit events", () => {
  const audit = createAuditLog();
  const service = createInvoiceAccess({ audit });
  assert.throws(() => service.read({ id: "u", tenantId: "tenant-b", role: "support_agent", active: true }, "inv-1"));
  assert.equal(audit.events().length, 0);
  service.read({ id: "u", tenantId: "tenant-a", role: "support_agent", active: true }, "inv-1");
  assert.deepEqual(audit.events()[0], { action: "invoice.read", actorId: "u", invoiceId: "inv-1" });
});
