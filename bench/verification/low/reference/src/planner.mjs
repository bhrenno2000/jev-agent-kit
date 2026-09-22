import { mergeWindows } from "./windows.mjs";

function assertRange(start, end, minGap) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end)
    throw new Error("invalid day range");
  if (!Number.isInteger(minGap) || minGap < 0) throw new Error("invalid minimum gap");
}

export function findAvailable(windows, dayStart, dayEnd, minGap = 0) {
  assertRange(dayStart, dayEnd, minGap);
  const busy = mergeWindows(windows).filter(
    (window) => window.end > dayStart && window.start < dayEnd,
  );
  const slots = [];
  let cursor = dayStart;
  for (const window of busy) {
    const start = Math.max(cursor, dayStart);
    const end = Math.min(window.start, dayEnd);
    if (start < end) slots.push({ start, end });
    cursor = Math.max(cursor, window.end);
  }
  if (cursor < dayEnd) slots.push({ start: cursor, end: dayEnd });
  return slots.filter((slot) => slot.end - slot.start >= minGap);
}
