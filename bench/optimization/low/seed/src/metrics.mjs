export function countCategories(items) {
  return Object.fromEntries(
    items.reduce(
      (map, item) => map.set(item.category, (map.get(item.category) ?? 0) + 1),
      new Map(),
    ),
  );
}
