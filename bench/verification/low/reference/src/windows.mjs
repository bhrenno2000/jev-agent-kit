function assertWindow(window) {
  if (
    !window ||
    typeof window !== "object" ||
    Array.isArray(window) ||
    !Number.isInteger(window.start) ||
    !Number.isInteger(window.end) ||
    window.start < 0 ||
    window.end > 1440 ||
    window.start >= window.end
  )
    throw new Error("invalid window");
}

export function normalizeWindows(windows) {
  if (!Array.isArray(windows)) throw new Error("windows must be an array");
  const copy = Array.from(windows, (window) => {
    assertWindow(window);
    return { start: window.start, end: window.end };
  });
  return copy.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function mergeWindows(windows) {
  const sorted = normalizeWindows(windows);
  const merged = [];
  for (const window of sorted) {
    const current = merged.at(-1);
    if (current && window.start <= current.end) current.end = Math.max(current.end, window.end);
    else merged.push({ ...window });
  }
  return merged;
}
