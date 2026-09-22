import { createAuditLog } from "./audit.mjs";
import { findInvoice } from "./invoices.mjs";
import { canReadInvoice } from "./policy.mjs";

export function createInvoiceAccess({ audit = createAuditLog() } = {}) {
  return {
    read(actor, invoiceId) {
      const invoice = findInvoice(invoiceId);
      if (!invoice || !canReadInvoice(actor, invoice)) throw new Error("invoice access denied");
      audit.append({ action: "invoice.read", actorId: actor.id, invoiceId: invoice.id });
      return { ...invoice };
    },
    audit,
  };
}
