import { describe, it, expect } from 'vitest';
import { clampQuantity, isValidQuantity } from './quantity.js';

describe('clampQuantity', () => {
  it('lets an emptied field stay empty instead of snapping to 1', () => {
    expect(clampQuantity('', 10)).toBe('');
  });

  it('accepts quantity 1', () => {
    expect(clampQuantity('1', 10)).toBe(1);
  });

  it('increases correctly', () => {
    expect(clampQuantity(3, 10)).toBe(3);
    expect(clampQuantity('12', 20)).toBe(12);
  });

  it('decreases correctly and never drops below 1', () => {
    expect(clampQuantity(0, 10)).toBe(1);
    expect(clampQuantity(-5, 10)).toBe(1);
  });

  it('never exceeds available stock', () => {
    expect(clampQuantity(99, 5)).toBe(5);
  });

  it('floors non-integer input', () => {
    expect(clampQuantity('2.9', 10)).toBe(2);
  });

  it('treats non-numeric input as empty', () => {
    expect(clampQuantity('abc', 10)).toBe('');
  });
});

describe('isValidQuantity', () => {
  it('rejects empty, zero, and out-of-range values', () => {
    expect(isValidQuantity('', 10)).toBe(false);
    expect(isValidQuantity(0, 10)).toBe(false);
    expect(isValidQuantity(11, 10)).toBe(false);
  });

  it('accepts values within [1, max]', () => {
    expect(isValidQuantity(1, 10)).toBe(true);
    expect(isValidQuantity(10, 10)).toBe(true);
  });
});
