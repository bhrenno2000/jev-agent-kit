export function cacheKey(scope, key) {
  if (typeof scope !== "string" || scope.length === 0) throw new Error("scope required");
  if (typeof key !== "string" || key.length === 0) throw new Error("key required");
  return key;
}
