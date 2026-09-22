export function isFresh(entry, now) {
  return Boolean(entry && (entry.promise || now < entry.expiresAt));
}
