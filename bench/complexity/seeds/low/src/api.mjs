const pages = new Map([
  [undefined, { items: ["alpha", "beta"], nextCursor: "cursor-2" }],
  ["cursor-2", { items: ["gamma"], nextCursor: "cursor-3" }],
  ["cursor-3", { items: ["delta", "epsilon"], nextCursor: undefined }],
]);

export function createCatalogApi() {
  const calls = [];
  return {
    async fetchPage(cursor) {
      calls.push(cursor);
      const page = pages.get(cursor);
      if (!page) throw new Error("unknown cursor");
      return { items: [...page.items], nextCursor: page.nextCursor };
    },
    calls() {
      return [...calls];
    },
  };
}
