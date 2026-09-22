export function createBackoff({ baseMs = 100, capMs = 2000 } = {}) {
  return {
    delay(attempt) {
      return Math.min(capMs, baseMs * 2 ** attempt);
    },
  };
}
