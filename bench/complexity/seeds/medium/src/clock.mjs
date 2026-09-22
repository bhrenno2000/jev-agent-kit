export function createClock() {
  const waits = [];
  return {
    async sleep(ms) {
      waits.push(ms);
    },
    waits() {
      return [...waits];
    },
  };
}
