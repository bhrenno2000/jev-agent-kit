export async function fetchAllPages(api, options = {}) {
  const maxPages = options.maxPages ?? 20;
  const items = [];
  let cursor;
  let pageCount = 0;
  do {
    if (pageCount >= maxPages) throw new Error("page limit exceeded");
    const page = await api.fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    pageCount += 1;
  } while (cursor !== undefined);
  return items;
}
