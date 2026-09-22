export function createFaults() {
  let next = false;
  return {
    failNext(name) {
      if (name === "persist") next = true;
    },
    consume(name) {
      if (name === "persist" && next) {
        next = false;
        throw new Error("persistence failed");
      }
    },
  };
}
