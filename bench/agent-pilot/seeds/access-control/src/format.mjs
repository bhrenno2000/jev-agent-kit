export function displayTotal(invoice) {
  return `$${(invoice.total / 100).toFixed(2)}`;
}
