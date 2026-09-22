export function createClock(now = () => Date.now()) {
  return { now };
}
