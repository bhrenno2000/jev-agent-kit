export function createLedger() {
  const entries = [];
  return {
    record(entry) {
      entries.push({ ...entry });
      return entries.at(-1);
    },
    all() {
      return entries.map((entry) => ({ ...entry }));
    },
  };
}
