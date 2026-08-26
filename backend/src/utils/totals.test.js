import { describe, it, expect } from 'vitest';
import { computeItemTotals, applyTax } from './totals.js';

describe('computeItemTotals', () => {
  it('computes a line total for quantity 1', () => {
    const { items, subtotal } = computeItemTotals([{ quantity: 1, unitPrice: 500, discount: 0 }]);
    expect(items[0].lineTotal).toBe(500);
    expect(subtotal).toBe(500);
  });

  it('scales the line total when quantity increases', () => {
    const { items, subtotal } = computeItemTotals([{ quantity: 3, unitPrice: 500, discount: 0 }]);
    expect(items[0].lineTotal).toBe(1500);
    expect(subtotal).toBe(1500);
  });

  it('scales the line total down when quantity decreases', () => {
    const { items, subtotal } = computeItemTotals([{ quantity: 1, unitPrice: 500, discount: 0 }]);
    expect(items[0].lineTotal).toBe(500);
    expect(subtotal).toBe(500);
  });

  it('sums multiple lines and never goes negative on discount', () => {
    const { items, subtotal } = computeItemTotals([
      { quantity: 2, unitPrice: 100, discount: 50 },
      { quantity: 1, unitPrice: 50, discount: 1000 },
    ]);
    expect(items[0].lineTotal).toBe(150);
    expect(items[1].lineTotal).toBe(0);
    expect(subtotal).toBe(150);
  });
});

describe('applyTax', () => {
  it('applies discount then tax rate', () => {
    const { taxAmount, total } = applyTax({ subtotal: 1000, discount: 100, taxRate: 10 });
    expect(taxAmount).toBe(90);
    expect(total).toBe(990);
  });

  it('handles zero tax', () => {
    const { taxAmount, total } = applyTax({ subtotal: 1000, discount: 0, taxRate: 0 });
    expect(taxAmount).toBe(0);
    expect(total).toBe(1000);
  });
});
