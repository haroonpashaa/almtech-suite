const DEFAULT_PAGE_SIZE = 500;

function invalidPage(message) {
  return new Error(`Could not load the complete product list: ${message}`);
}

function validatePage(page, pageNumber, expected = {}) {
  if (!page || !Array.isArray(page.items)) throw invalidPage(`page ${pageNumber} had an invalid response`);
  if (!Number.isSafeInteger(page.total) || page.total < 0) throw invalidPage('the total product count was missing');
  if (page.page !== pageNumber) throw invalidPage(`page ${pageNumber} was missing`);
  if (!Number.isSafeInteger(page.limit) || page.limit < 1) throw invalidPage('the page size was invalid');
  if (expected.total !== undefined && page.total !== expected.total) {
    throw invalidPage('the catalogue changed while it was loading; please retry');
  }
  if (expected.limit !== undefined && page.limit !== expected.limit) {
    throw invalidPage('the page size changed while the catalogue was loading; please retry');
  }

  const expectedLength = Math.max(0, Math.min(page.limit, page.total - (pageNumber - 1) * page.limit));
  if (page.items.length !== expectedLength) {
    throw invalidPage(`page ${pageNumber} was incomplete; please retry`);
  }
}

/**
 * Fetch every row matching the caller's filters using the existing paged API.
 * Requests are sequential so a large catalogue never fans out into many
 * simultaneous requests. A partial or inconsistent result is rejected rather
 * than being presented as a complete selection list.
 */
export async function loadCompletePurchaseOrderCatalogue(fetchPage, filters = {}) {
  const first = await fetchPage(1, DEFAULT_PAGE_SIZE, filters);
  validatePage(first, 1);

  const { total, limit } = first;
  const items = [...first.items];
  const ids = new Set();
  for (const item of items) {
    if (!item?._id || ids.has(String(item._id))) throw invalidPage('duplicate or unidentified products were returned');
    ids.add(String(item._id));
  }

  const pageCount = Math.ceil(total / limit);
  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    const next = await fetchPage(pageNumber, limit, filters);
    validatePage(next, pageNumber, { total, limit });
    for (const item of next.items) {
      if (!item?._id || ids.has(String(item._id))) throw invalidPage('duplicate or unidentified products were returned');
      ids.add(String(item._id));
      items.push(item);
    }
  }

  if (items.length !== total) throw invalidPage('not every matching product was returned; please retry');
  return { items, total };
}

export function buildPurchaseOrderItemsPayload(cart) {
  return cart.map(({ product, quantity, unitCost }) => ({
    product: String(product?._id ?? product),
    quantity: Number(quantity),
    unitCost: Number(unitCost),
  }));
}
