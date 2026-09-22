export function textMatch(item, query) {
  return !query || item.name.toLowerCase().includes(query.toLowerCase());
}
