import { describe, expect, it, vi } from 'vitest';
import { addProductToPurchaseOrder, toggleDisplayedProductsInPurchaseOrder } from './purchaseOrderProductSelection.js';
import { buildPurchaseOrderItemsPayload, loadCompletePurchaseOrderCatalogue } from './purchaseOrderProductCatalogue.js';

function page(items, total, pageNumber, limit = 500) {
  return { items, total, page: pageNumber, limit };
}

function product(index) {
  return { _id: `product-${index}`, name: `Laptop ${index}`, sku: `SKU-${index}`, purchasePrice: index + 100 };
}

describe('complete Purchase Order product catalogue', () => {
  it('loads an 850-product catalogue across sequential pages and Select All adds every product once', async () => {
    const all = Array.from({ length: 850 }, (_, i) => product(i));
    const calls = [];
    let activeCalls = 0;
    const fetchPage = vi.fn(async (pageNumber, limit) => {
      calls.push([pageNumber, limit]);
      activeCalls += 1;
      expect(activeCalls).toBe(1);
      await Promise.resolve();
      activeCalls -= 1;
      const start = (pageNumber - 1) * limit;
      return page(all.slice(start, start + limit), all.length, pageNumber, limit);
    });

    const catalogue = await loadCompletePurchaseOrderCatalogue(fetchPage);
    const cart = toggleDisplayedProductsInPurchaseOrder([], catalogue.items);

    expect(calls).toEqual([[1, 500], [2, 500]]);
    expect(catalogue.total).toBe(850);
    expect(catalogue.items).toHaveLength(850);
    expect(cart).toHaveLength(850);
    expect(new Set(cart.map((line) => line.product)).size).toBe(850);
    expect(cart[0]).toMatchObject({ product: 'product-0', quantity: 1, unitCost: 100 });
    expect(cart[849]).toMatchObject({ product: 'product-849', quantity: 1, unitCost: 949 });
    cart[0] = { ...cart[0], quantity: '4', unitCost: '777.25' };
    const payload = buildPurchaseOrderItemsPayload(cart);
    expect(payload).toHaveLength(850);
    expect(new Set(payload.map((line) => line.product)).size).toBe(850);
    expect(payload[0]).toEqual({ product: 'product-0', quantity: 4, unitCost: 777.25 });
  });

  it('loads every product matching the current search filter', async () => {
    const matches = [product(1), product(2)];
    const filters = { q: 'ThinkPad' };
    const fetchPage = vi.fn(async (pageNumber, limit, receivedFilters) => {
      expect(receivedFilters).toEqual(filters);
      return page(matches, matches.length, pageNumber, limit);
    });

    const catalogue = await loadCompletePurchaseOrderCatalogue(fetchPage, filters);
    const selected = toggleDisplayedProductsInPurchaseOrder([], catalogue.items);

    expect(selected.map((line) => line.product)).toEqual(['product-1', 'product-2']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(1, 500, filters);
  });

  it('preserves selections outside changed filters and deselects only the matching subset', async () => {
    const all = [product(1), product(2), product(3)];
    let cart = toggleDisplayedProductsInPurchaseOrder([], all);
    const filteredMatches = [all[0], all[1]];
    cart = toggleDisplayedProductsInPurchaseOrder(cart, filteredMatches);

    expect(cart.map((line) => line.product)).toEqual(['product-3']);
    const afterChangingFilter = addProductToPurchaseOrder(cart, all[0]);
    expect(afterChangingFilter.map((line) => line.product)).toEqual(['product-3', 'product-1']);
  });

  it('does not add a duplicate product line', () => {
    const selected = addProductToPurchaseOrder([], product(7));
    expect(addProductToPurchaseOrder(selected, product(7))).toBe(selected);
    expect(selected).toHaveLength(1);
  });

  it('rejects failed, incomplete, inconsistent, or duplicate pages rather than allowing partial Select All', async () => {
    await expect(loadCompletePurchaseOrderCatalogue(async () => {
      throw new Error('network unavailable');
    })).rejects.toThrow('network unavailable');

    await expect(loadCompletePurchaseOrderCatalogue(async () => page([product(0)], 2, 1, 500)))
      .rejects.toThrow(/page 1 was incomplete/i);

    const firstPage = Array.from({ length: 500 }, (_, index) => product(index));
    await expect(loadCompletePurchaseOrderCatalogue(async (pageNumber, limit) =>
      page(pageNumber === 1 ? firstPage : [], 501, pageNumber, limit)))
      .rejects.toThrow(/page 2 was incomplete/i);

    await expect(loadCompletePurchaseOrderCatalogue(async (pageNumber, limit) =>
      page(pageNumber === 1 ? firstPage : [product(500)], pageNumber === 1 ? 501 : 502, pageNumber, limit)))
      .rejects.toThrow(/catalogue changed/i);

    await expect(loadCompletePurchaseOrderCatalogue(async (pageNumber, limit) =>
      page([product(0)], 2, pageNumber, 1)))
      .rejects.toThrow(/duplicate/i);
  });

  it('builds a unique save payload with each selected product, quantity and entered purchase cost', () => {
    const cart = [
      { product: { _id: 'p1' }, quantity: '3', unitCost: '725.50' },
      { product: 'p2', quantity: 2, unitCost: 0 },
    ];
    expect(buildPurchaseOrderItemsPayload(cart)).toEqual([
      { product: 'p1', quantity: 3, unitCost: 725.5 },
      { product: 'p2', quantity: 2, unitCost: 0 },
    ]);
  });
});
