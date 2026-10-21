import { describe, expect, it } from 'vitest';
import { compactSerials, serialsAreSubmittable } from './cartSerials.js';
import { clampQuantity, isValidQuantity } from './quantity.js';
import {
  addPosCartItem,
  buildPosProductParams,
  calculatePosTotals,
  emptyPosProductFilters,
  filterPosModelOptions,
  removePosCartItem,
  togglePosModel,
} from './posProductSelection.js';

const trackedProduct = {
  _id: 'product-1', name: 'ThinkPad X1', sku: 'POS-X1', model: 'ThinkPad X1', brand: 'Lenovo',
  ram: '16GB', processor: 'i7', storage: '512GB SSD', sellingPrice: 100, stock: 2,
  tracksSerials: true,
  serials: [{ serial: 'SN-1', status: 'in_stock' }, { serial: 'SN-2', status: 'in_stock' }],
};

describe('POS product selection', () => {
  it('selects one or multiple exact models, distinguishes similar names, and resets all filters', () => {
    const options = ['ThinkPad X1', 'ThinkPad X1 Carbon'];
    expect(filterPosModelOptions(options, 'carbon')).toEqual(['ThinkPad X1 Carbon']);
    const one = togglePosModel([], 'ThinkPad X1');
    expect(one).toEqual(['ThinkPad X1']);
    expect(togglePosModel(one, 'ThinkPad X1 Carbon')).toEqual(options);
    expect(togglePosModel(options, 'ThinkPad X1')).toEqual(['ThinkPad X1 Carbon']);
    expect(emptyPosProductFilters()).toEqual({ q: '', models: [], brand: '', ram: '', processor: '', storage: '', serial: '' });
  });

  it('builds compatible server filters and omits cleared values', () => {
    expect(buildPosProductParams({
      q: ' X1 ', models: ['ThinkPad X1'], brand: ' Lenovo ', ram: '16GB', processor: 'i7', storage: '512GB', serial: 'SN-1',
    })).toEqual({
      q: 'X1', models: '["ThinkPad X1"]', brand: 'Lenovo', ram: '16GB', processor: 'i7', storage: '512GB', serial: 'SN-1',
    });
    expect(Object.values(buildPosProductParams(emptyPosProductFilters())).every((value) => value === undefined)).toBe(true);
  });

  it('adds a specific serial unit, prevents duplicate or excess stock, and retains bulk quantity behavior', () => {
    const first = addPosCartItem([], trackedProduct, 'SN-1');
    expect(first.error).toBeNull();
    expect(first.cart[0].serials).toEqual(['SN-1']);
    expect(first.cart[0]).toMatchObject({ processor: 'i7', storage: '512GB SSD', model: 'ThinkPad X1' });
    expect(addPosCartItem(first.cart, trackedProduct, 'SN-1').error).toMatch(/not available/i);

    const second = addPosCartItem(first.cart, trackedProduct, 'SN-2');
    expect(second.cart[0].quantity).toBe(2);
    expect(compactSerials(second.cart[0].serials)).toEqual(['SN-1', 'SN-2']);
    expect(serialsAreSubmittable(second.cart[0].serials, 2)).toBe(true);

    expect(addPosCartItem(second.cart, trackedProduct, '').error).toMatch(/Only 2/i);
    expect(addPosCartItem([], { ...trackedProduct, tracksSerials: false, serials: [] }, '').cart[0].quantity).toBe(1);
    expect(addPosCartItem([], { ...trackedProduct, active: false }, '').error).toMatch(/inactive/i);
  });

  it('keeps quantity validation, removal, discounts and totals consistent', () => {
    expect(clampQuantity('4', 3)).toBe(3);
    expect(isValidQuantity(4, 3)).toBe(false);
    const cart = [
      { product: 'a', quantity: 2, unitPrice: 100, discount: 10 },
      { product: 'b', quantity: 1, unitPrice: 50, discount: 0 },
    ];
    expect(calculatePosTotals(cart, 20, 10)).toEqual({ subtotal: 240, tax: 22, total: 242 });
    expect(removePosCartItem(cart, 0)).toEqual([cart[1]]);
    expect(calculatePosTotals(removePosCartItem(cart, 0), 0, 0).total).toBe(50);
  });
});
