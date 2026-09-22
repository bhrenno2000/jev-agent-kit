export function createFaults() {
  const failures = new Set();
  return {
    failNext(name) {
      failures.add(name);
    },
    consume(name) {
      if (failures.delete(name)) throw new Error(`${name} failed`);
    },
  };
}
