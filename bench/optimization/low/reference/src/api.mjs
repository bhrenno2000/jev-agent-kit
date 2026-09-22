export function createCatalogApi(pages) {
  const calls = [];
  return {
    async fetchPage(cursor) {
      calls.push(cursor);
      const page = pages.get(cursor);
      if (!page) throw new Error("unknown cursor");
      return { items: page.items.map((item) => ({ ...item })), nextCursor: page.nextCursor };
    },
    calls: () => [...calls],
  };
}
