export function byName(items) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}
