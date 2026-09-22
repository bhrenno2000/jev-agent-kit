export function hasInvoiceRole(actor) {
  return actor?.active === true && ["billing_admin", "support_agent"].includes(actor.role);
}
