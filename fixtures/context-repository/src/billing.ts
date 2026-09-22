export function requestRefund(transactionId: string): string {
  return `refund:${transactionId}`;
}
