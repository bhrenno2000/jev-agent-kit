export function createFailureStore() {
  const records = [];
  return {
    save(record) {
      records.push(JSON.parse(JSON.stringify(record)));
    },
    all() {
      return JSON.parse(JSON.stringify(records));
    },
  };
}
