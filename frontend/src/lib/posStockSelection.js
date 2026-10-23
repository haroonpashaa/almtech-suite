import { addPosCartItem } from './posProductSelection.js';

export function remainingPosStock(product, cart) {
  const used = cart.filter(line => line.product === product._id).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  return product.active === false ? 0 : Math.max(0, Number(product.stock) - used);
}

export function selectPosStock(selection, products, cart) {
  const next = { ...selection };
  for (const product of products) {
    const remaining = remainingPosStock(product, cart);
    if (Number.isSafeInteger(remaining) && remaining > 0) {
      next[product._id] = { product, quantity: selection[product._id]?.quantity ?? remaining };
    }
  }
  return next;
}

// Build the whole batch before returning any cart changes. A stale quantity or
// serial rejects the entire selection; no partial additions or inventory writes.
export function addPosStockSelection(cart, selection, preferredSerials = {}) {
  const next = [...cart];
  const seen = new Set();
  const fail = error => ({ cart, error });
  if (!selection.length) return fail('Select products to add to the cart');
  for (const { product, quantity: rawQuantity } of selection) {
    const quantity = Number(rawQuantity);
    if (!product?._id || seen.has(product._id)) return fail('Select each product only once');
    seen.add(product._id);
    const remaining = remainingPosStock(product, next);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > remaining) {
      return fail(`Enter a quantity from 1 to ${remaining} for ${product.name}`);
    }
    const index = next.findIndex(line => line.product === product._id);
    const existing = next[index];
    if (next.filter(line => line.product === product._id).length > 1) return fail(`Review duplicate cart lines for ${product.name}`);
    if (existing && (!Number.isSafeInteger(Number(existing.quantity)) || Number(existing.quantity) < 1 || !!existing.tracksSerials !== !!product.tracksSerials)) {
      return fail(`Review the existing cart quantity and serial tracking for ${product.name}`);
    }
    const totalQuantity = Number(existing?.quantity || 0) + quantity;
    let serials = [];
    if (product.tracksSerials) {
      const available = [...new Set((product.serials || []).filter(unit => unit.status === 'in_stock').map(unit => unit.serial).filter(Boolean))];
      serials = existing ? [...(existing.serials || [])] : [];
      const chosen = serials.filter(Boolean);
      if (chosen.length !== new Set(chosen).size || chosen.some(serial => !available.includes(serial)) || serials.length > totalQuantity) {
        return fail(`Review the selected serial numbers for ${product.name}`);
      }
      const preferred = preferredSerials[product._id];
      if (preferred && !available.includes(preferred)) return fail(`${preferred} is no longer available for ${product.name}`);
      const unused = [...new Set([preferred, ...available].filter(serial => serial && !chosen.includes(serial)))];
      if (available.length < totalQuantity) return fail(`Only ${available.length} available serial number(s) for ${product.name}. Select fewer units or review this product individually.`);
      while (serials.length < totalQuantity) serials.push('');
      let slot = 0;
      serials = serials.map(serial => serial || unused[slot++]);
    }
    const line = existing || addPosCartItem([], product).cart[0];
    const updated = { ...line, quantity: totalQuantity, stock: product.stock, serials };
    if (index < 0) next.push(updated);
    else next[index] = updated;
  }
  return { cart: next, error: null };
}

// Select All is explicitly all filtered pages, not only the first visible page.
// Reject changing/duplicate pages instead of silently selecting an incomplete set.
export async function loadAllPosStock(fetchPage) {
  const first = await fetchPage(1, 500);
  const total = first.total;
  const limit = first.limit;
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Could not verify the matching product count. Try Select All again.');
  const products = [];
  const ids = new Set();
  for (let page = 1; page <= Math.max(1, Math.ceil(total / limit)); page += 1) {
    const data = page === 1 ? first : await fetchPage(page, limit);
    if (data.total !== total || data.page !== page || data.limit !== limit || !Array.isArray(data.items) || data.items.length !== Math.min(limit, Math.max(0, total - (page - 1) * limit))) {
      throw new Error('The product list changed during selection. Try Select All again.');
    }
    for (const product of data.items) {
      if (!product._id || ids.has(product._id)) throw new Error('The product list changed during selection. Try Select All again.');
      ids.add(product._id);
      products.push(product);
    }
  }
  return products;
}
