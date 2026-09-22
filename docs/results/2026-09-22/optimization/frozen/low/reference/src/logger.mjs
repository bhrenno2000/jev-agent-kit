export function recordPage(log, cursor) {
  log.push({ cursor, at: Date.now() });
}
