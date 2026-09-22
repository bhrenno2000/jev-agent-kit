export const pendingEntry = (promise, generation) => ({ promise, generation, expiresAt: 0 });
export const valueEntry = (value, generation, expiresAt) => ({ value, generation, expiresAt });
