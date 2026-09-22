export function createDedupe() {
  const delivered = new Map();
  return {
    get(id) {
      return delivered.get(id);
    },
    set(id, value) {
      delivered.set(id, { ...value });
    },
  };
}
