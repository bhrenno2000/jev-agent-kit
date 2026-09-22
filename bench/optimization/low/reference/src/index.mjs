import { selectRecords } from "./catalog.mjs";
export function listCatalog(records, options = {}) {
  const offset = options.offset === undefined ? 0 : options.offset;
  const limit = options.limit === undefined ? 20 : options.limit;
  if (
    !Array.isArray(records) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 0
  )
    throw new Error("invalid options");
  const filtered = selectRecords(records, options);
  const items = filtered.slice(offset, offset + limit).map((record) => structuredClone(record));
  return {
    items,
    total: filtered.length,
    nextOffset: offset + limit < filtered.length && limit > 0 ? offset + limit : null,
  };
}
