export function selectRecords(records, options) {
  const query = options.query?.toLowerCase();
  return records.filter(
    (record) =>
      (options.category === undefined || record.category === options.category) &&
      (query === undefined || record.name.toLowerCase().includes(query)),
  );
}
