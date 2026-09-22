export function parseInvoice(input: string): number {
  return Number(input);
}

export function renderInvoice(total: number): string {
  return `$${total}`;
}
