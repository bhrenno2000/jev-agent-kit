export async function fetchAllPages(api, options = {}) {
  const maxPages = options.maxPages ?? 20;
  const items = [];
  let cursor = "";
  let pageCount = 0;
  while (cursor && pageCount < maxPages) {
    const page = await api.fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    pageCount += 1;
  }
  if (cursor) throw new Error("page limit exceeded");
  return items;
}
