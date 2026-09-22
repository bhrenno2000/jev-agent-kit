export function refundNotice(refund) {
  return `Refund ${refund.requestId} issued for ${refund.amount.toFixed(2)}`;
}
