import { describe, expect, it } from 'vitest';
import { allocateBulkPrice } from './bulkPricing.js';
import { allocateBulkPrice as serverAllocate } from '../../../backend/src/utils/bulkPricing.js';

describe.each([['frontend', allocateBulkPrice], ['backend', serverAllocate]])('%s batch allocation', (_name, allocate) => {
  it('prices 450 of 500 units for one exact batch amount without changing buying cost', () => {
    const items = [{ product: 'p1', quantity: 450, unitCost: 500, unitPrice: 900, discount: 0, serials: ['SN-1'] }];
    const before = structuredClone(items);
    const priced = allocate(items, '300000.01');
    expect(priced.subtotal).toBe(300000.01);
    expect(priced.items[0]).toMatchObject({ quantity: 450, unitCost: 500, lineTotal: 300000.01, serials: ['SN-1'] });
    expect(Math.round((priced.items[0].unitPrice * 450 - priced.items[0].discount) * 100)).toBe(30000001);
    expect(items).toEqual(before);
  });
  it('allocates rounding pennies deterministically across mixed quantities', () => {
    const result = allocate([{ quantity: 2 }, { quantity: 1 }], 100);
    expect(result.items.map(item => item.lineTotal)).toEqual([66.66, 33.34]);
    expect(result.items.map(item => item.discount)).toEqual([0.02, 0]);
    expect(allocate([{ quantity: 1 }, { quantity: 1 }, { quantity: 1 }], 0.01).items.map(item => item.lineTotal)).toEqual([0, 0, 0.01]);
  });
  it.each(['', ' ', null, undefined, false, {}, [], -1, 0, 1.234, Infinity, NaN, Number.MAX_SAFE_INTEGER])('rejects invalid batch amount %j', amount => {
    expect(() => allocate([{ quantity: 1 }], amount)).toThrow();
  });
  it.each([[], [{ quantity: 0 }], [{ quantity: '' }], [{ quantity: 1.5 }], [{ quantity: -1 }], [{ quantity: Number.MAX_SAFE_INTEGER }, { quantity: 1 }]])('rejects empty or invalid selected quantities %j', items => {
    expect(() => allocate(items, 100)).toThrow();
  });
});

it('keeps client preview and server totals identical across many batch sizes and quantities', () => {
  for (const quantities of [[1], [450], [200, 250], [1, 2, 3, 7], [50, 200, 1, 199]]) {
    for (const amount of [0.01, 1, 100, 99999.99, 1234567.89]) {
      const items = quantities.map((quantity, i) => ({ product: `p-${i}`, quantity, unitCost: 123.45 }));
      const result = allocateBulkPrice(items, amount);
      expect(result).toEqual(serverAllocate(items, amount));
      expect(result.items.reduce((total, line) => total + Math.round(line.lineTotal * 100), 0)).toBe(Math.round(amount * 100));
      for (const line of result.items) {
        expect(line.discount).toBeGreaterThanOrEqual(0);
        expect(Math.round((line.quantity * line.unitPrice - line.discount) * 100)).toBe(Math.round(line.lineTotal * 100));
      }
    }
  }
});
