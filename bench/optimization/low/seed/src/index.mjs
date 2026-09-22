import { selectRecords } from "./catalog.mjs";
export function listCatalog(records, options = {}) {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  if (
    !Array.isArray(records) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 0
  )
    throw new Error("invalid options");
  const filtered = selectRecords(records, options);
  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    total: limit === 0 ? 0 : filtered.length,
    nextOffset: offset + limit < filtered.length && limit > 0 ? offset + limit : null,
  };
}
