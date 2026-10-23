import { describe, it, expect } from 'vitest';
import { allocateBulkPurchase } from './bulkPurchase.js';
import { allocateBulkPurchase as backendAllocation } from '../../../backend/src/utils/bulkPurchase.js';

describe('bulk purchase allocation contract', () => {
  it.each([[2, 1, 100], [449, 1, 900], [1, 1, 0.01], [450, 50, 1], [1, 1, 999999.99]])('allocates exact pennies and preserves original costs (%s, %s, %s)', (a, b, amount) => {
    const items = [{ quantity: a, unitCost: 123, lineTotal: a * 123 }, { quantity: b, unitCost: 456, lineTotal: b * 456 }];
    const snapshot = structuredClone(items);
    const result = allocateBulkPurchase(items, amount);
    expect(result).toEqual(backendAllocation(items, amount));
    expect(result.items.reduce((sum, line) => sum + Math.round(line.bulkAllocatedTotal * 100), 0)).toBe(Math.round(amount * 100));
    expect(result.items.map(({ bulkAllocatedTotal, ...original }) => original)).toEqual(snapshot);
    expect(items).toEqual(snapshot);
  });
  it('supports a single product and rejects fractional quantities and excess precision', () => {
    expect(allocateBulkPurchase([{ quantity: 450, unitCost: 100 }], 900).items[0]).toEqual({ quantity: 450, unitCost: 100, bulkAllocatedTotal: 900 });
    expect(() => allocateBulkPurchase([{ quantity: 1.5 }], 100)).toThrow(/whole quantities/);
    expect(() => allocateBulkPurchase([{ quantity: 1 }], 1.001)).toThrow(/two decimal/);
  });
});
