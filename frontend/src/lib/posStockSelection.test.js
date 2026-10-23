import { describe, expect, it, vi } from 'vitest';
import { addPosCartItem } from './posProductSelection.js';
import { addPosStockSelection, loadAllPosStock, remainingPosStock, selectPosStock } from './posStockSelection.js';

const laptop = { _id: 'p1', name: 'Laptop', sku: 'SKU-1', stock: 500, sellingPrice: 1000, model: 'X1' };
const tracked = { ...laptop, stock: 3, tracksSerials: true, serials: ['SN-1', 'SN-2', 'SN-3'].map(serial => ({ serial, status: 'in_stock' })) };

describe('POS stock batch selection', () => {
  it('selects remaining stock, keeps edited quantities, and skips unavailable/inactive products', () => {
    const cart = addPosCartItem([], laptop).cart;
    expect(remainingPosStock(laptop, cart)).toBe(499);
    const selection = selectPosStock({}, [laptop, { ...laptop, _id: 'empty', stock: 0 }, { ...laptop, _id: 'inactive', active: false }], cart);
    expect(Object.keys(selection)).toEqual(['p1']);
    expect(selection.p1.quantity).toBe(499);
    selection.p1.quantity = 450;
    expect(selectPosStock(selection, [laptop], cart).p1.quantity).toBe(450);
  });
  it('adds 450 of 500 and multiple products without mutating products or inventory', () => {
    const second = { ...laptop, _id: 'p2', sku: 'SKU-2', stock: 100 };
    const result = addPosStockSelection([], [{ product: laptop, quantity: 450 }, { product: second, quantity: 80 }]);
    expect(result.error).toBeNull();
    expect(result.cart.map(line => [line.product, line.quantity])).toEqual([['p1', 450], ['p2', 80]]);
    expect(laptop.stock).toBe(500);
    expect(second.stock).toBe(100);
    expect(addPosStockSelection([], [{ product: laptop, quantity: 1 }]).cart[0].quantity).toBe(1);
  });
  it('merges with the matching cart line and preserves its price, specs, discount and position', () => {
    const line = { ...addPosCartItem([], laptop).cart[0], name: 'Edited name', processor: 'i7', unitPrice: '1200', discount: '10' };
    const other = { ...line, product: 'p2', name: 'Other' };
    const cart = [other, line];
    const result = addPosStockSelection(cart, [{ product: laptop, quantity: 4 }]);
    expect(result.cart[1]).toMatchObject({ ...line, quantity: 5 });
    expect(result.cart[0]).toBe(other);
    expect(cart[1].quantity).toBe(1);
  });
  it('preserves chosen serials, fills remaining slots with distinct available serials, and honors an individual serial choice', () => {
    const cart = addPosCartItem([], tracked, 'SN-2').cart;
    const before = structuredClone(cart);
    const result = addPosStockSelection(cart, [{ product: tracked, quantity: 2 }], { p1: 'SN-3' });
    expect(result.cart[0].serials).toEqual(['SN-2', 'SN-3', 'SN-1']);
    expect(cart).toEqual(before);
    expect(addPosStockSelection([], [{ product: tracked, quantity: 1 }], { p1: 'SN-3' }).cart[0].serials).toEqual(['SN-3']);
  });
  it('fills existing blank slots and never selects sold or duplicate serial records', () => {
    const product = { ...tracked, serials: [...tracked.serials, tracked.serials[0], { serial: 'SOLD', status: 'sold' }] };
    const cart = addPosCartItem([], product).cart;
    const result = addPosStockSelection(cart, [{ product, quantity: 2 }]);
    expect(result.cart[0].serials).toEqual(['SN-1', 'SN-2', 'SN-3']);
  });
  it.each(['', 0, -1, 1.5, 501, NaN, Infinity])('rejects invalid quantity %j without a partial addition', quantity => {
    const cart = [];
    const result = addPosStockSelection(cart, [{ product: { ...laptop, _id: 'p2' }, quantity: 1 }, { product: laptop, quantity }]);
    expect(result.error).toBeTruthy();
    expect(result.cart).toBe(cart);
  });
  it('rejects missing, sold or insufficient serials without partially changing the cart', () => {
    for (const product of [
      { ...tracked, serials: [] },
      { ...tracked, serials: [{ serial: 'SOLD', status: 'sold' }] },
      { ...tracked, serials: [tracked.serials[0]] },
    ]) {
      expect(addPosStockSelection([], [{ product, quantity: 2 }]).error).toMatch(/available serial/);
    }
    expect(addPosStockSelection([], [{ product: tracked, quantity: 1 }], { p1: 'SOLD' }).error).toMatch(/no longer available/);
    const cart = addPosCartItem([], tracked, 'SN-1').cart;
    expect(addPosStockSelection(cart, [{ product: { ...tracked, serials: tracked.serials.slice(1) }, quantity: 1 }]).cart).toBe(cart);
  });
  it('rejects overstock, invalid existing quantities and duplicate product entries', () => {
    const cart = addPosCartItem([], laptop).cart;
    expect(addPosStockSelection(cart, [{ product: laptop, quantity: 500 }]).cart).toBe(cart);
    expect(addPosStockSelection([{ ...cart[0], quantity: '' }], [{ product: laptop, quantity: 1 }]).error).toMatch(/existing cart/);
    expect(addPosStockSelection([], [{ product: laptop, quantity: 1 }, { product: laptop, quantity: 1 }]).error).toMatch(/only once/);
  });
});

describe('Select All matching pages', () => {
  it('loads beyond the endpoint cap and returns all 1001 matching products', async () => {
    const products = Array.from({ length: 1001 }, (_, i) => ({ ...laptop, _id: `p-${i}` }));
    const fetchPage = vi.fn(async (page, limit) => ({ page, limit, total: products.length, items: products.slice((page - 1) * limit, page * limit) }));
    expect(await loadAllPosStock(fetchPage)).toEqual(products);
    expect(fetchPage.mock.calls).toEqual([[1, 500], [2, 500], [3, 500]]);
  });
  it('handles zero matching products', async () => {
    expect(await loadAllPosStock(async () => ({ total: 0, page: 1, limit: 500, items: [] }))).toEqual([]);
  });
  it.each(['changed-total', 'duplicate', 'missing-row', 'wrong-page', 'failed-request'])('rejects %s instead of selecting an incomplete set', async problem => {
    const products = Array.from({ length: 501 }, (_, i) => ({ ...laptop, _id: `p-${i}` }));
    await expect(loadAllPosStock(async (page, limit) => {
      if (page === 2 && problem === 'failed-request') throw new Error('Network error');
      return { page: page === 2 && problem === 'wrong-page' ? 1 : page, limit,
        total: page === 2 && problem === 'changed-total' ? 502 : 501,
        items: page === 1 ? products.slice(0, 500) : problem === 'duplicate' ? [products[0]] : problem === 'missing-row' ? [] : [products[500]],
      };
    })).rejects.toThrow();
  });
});
