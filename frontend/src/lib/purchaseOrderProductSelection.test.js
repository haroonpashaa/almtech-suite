import { describe, expect, it } from 'vitest';
import {
  hasEligibleDisplayedSelection,
  toggleDisplayedProductsInPurchaseOrder,
  toggleProductInPurchaseOrder,
} from './purchaseOrderProductSelection.js';

const products = [
  { _id: 'p1', name: 'Laptop', sku: 'LAP-1', purchasePrice: 125 },
  { _id: 'p2', name: 'Tablet', sku: 'TAB-2', purchasePrice: 0 },
];

describe('purchase order product selection', () => {
  it('selects all displayed products when no eligible displayed product is selected', () => {
    const cart = toggleDisplayedProductsInPurchaseOrder([], products);
    expect(cart.map((line) => line.product)).toEqual(['p1', 'p2']);
    expect(cart).toMatchObject([
      { name: 'Laptop', sku: 'LAP-1', quantity: 1, unitCost: 125, received: 0 },
      { name: 'Tablet', sku: 'TAB-2', quantity: 1, unitCost: '', received: 0 },
    ]);
    expect(hasEligibleDisplayedSelection([], products)).toBe(false);
    expect(hasEligibleDisplayedSelection(cart, products)).toBe(true);
  });

  it('toggles an individual product off and leaves other lines selected', () => {
    const cart = toggleDisplayedProductsInPurchaseOrder([], products);
    const next = toggleProductInPurchaseOrder(cart, products[0]);
    expect(next.map((line) => line.product)).toEqual(['p2']);
    expect(hasEligibleDisplayedSelection(next, products)).toBe(true);
  });

  it('deselects a partial visible selection in one action and preserves hidden lines', () => {
    const existing = [
      { product: 'hidden', name: 'Hidden product', quantity: 1, unitCost: 10, received: 0 },
      { product: 'p1', name: 'Laptop', quantity: 1, unitCost: 125, received: 0 },
    ];
    expect(hasEligibleDisplayedSelection(existing, products)).toBe(true);
    const next = toggleDisplayedProductsInPurchaseOrder(existing, products);
    expect(next.map((line) => line.product)).toEqual(['hidden']);
  });

  it('deselects all eligible displayed lines and preserves received lines', () => {
    const existing = [
      { product: 'p1', name: 'Laptop', quantity: 2, unitCost: 125, received: 1 },
      { product: 'p2', name: 'Tablet', quantity: 2, unitCost: 50, received: 0 },
    ];
    expect(hasEligibleDisplayedSelection(existing, products)).toBe(true);
    const next = toggleDisplayedProductsInPurchaseOrder(existing, products);
    expect(next.map((line) => line.product)).toEqual(['p1']);
    expect(hasEligibleDisplayedSelection(next, products)).toBe(false);
    expect(toggleDisplayedProductsInPurchaseOrder(next, [])).toBe(next);
  });

  it('keeps received-only displayed selections protected', () => {
    const receivedLine = [{ product: 'p1', name: 'Laptop', quantity: 1, unitCost: 125, received: 1 }];
    expect(hasEligibleDisplayedSelection(receivedLine, [products[0]])).toBe(false);
    expect(toggleDisplayedProductsInPurchaseOrder(receivedLine, [products[0]])).toBe(receivedLine);
    expect(toggleProductInPurchaseOrder(receivedLine, products[0])).toBe(receivedLine);
  });
});
