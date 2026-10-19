import { describe, it, expect } from 'vitest';
import { parsePricingPaste } from './pricingPaste.js';

describe('parsePricingPaste', () => {
  it('accepts a spreadsheet row or column and normalizes grouped prices', () => {
    expect(parsePricingPaste('1,200.50\t25\t0', 3)).toEqual(['1200.5', '25', '0']);
    expect(parsePricingPaste('10\n20.25', 2)).toEqual(['10', '20.25']);
  });
  it('rejects invalid prices, multi-column grids and overflow', () => {
    expect(() => parsePricingPaste('10\tbad', 2)).toThrow(/Invalid price/);
    expect(parsePricingPaste('10\t20\n30\t40', 4)).toEqual(['10', '20', '30', '40']);
    expect(() => parsePricingPaste('10\t20\n30', 3)).toThrow(/rectangular range/);
    expect(() => parsePricingPaste('10\t20', 1)).toThrow(/up to 1 price/);
  });
});
