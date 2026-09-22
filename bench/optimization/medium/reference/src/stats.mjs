export const hitRate = (hits, misses) => (hits + misses ? hits / (hits + misses) : 0);
