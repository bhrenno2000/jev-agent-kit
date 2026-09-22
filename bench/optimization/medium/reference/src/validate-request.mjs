export function validateRequest(key, loader) {
  if (typeof key !== "string" || key.length === 0 || typeof loader !== "function")
    throw new Error("invalid request");
}
