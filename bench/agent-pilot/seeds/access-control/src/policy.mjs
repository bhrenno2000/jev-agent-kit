import { hasInvoiceRole } from "./roles.mjs";

export function canReadInvoice(actor, invoice) {
  return hasInvoiceRole(actor) && invoice?.status !== "deleted";
}
