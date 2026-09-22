export function tenantKey(tenantId, value) {
  if (typeof tenantId !== "string" || tenantId.length === 0) throw new Error("tenant required");
  return `${tenantId}:${value}`;
}
