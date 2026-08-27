import { describe, it, expect } from 'vitest';
import { requirePositiveWholeQuantity, requireNonZeroWholeQuantity } from './quantity.js';

describe('requirePositiveWholeQuantity', () => {
  it('accepts a positive integer', () => {
    expect(requirePositiveWholeQuantity(3, 'Laptop')).toBe(3);
  });

  it('coerces a numeric string', () => {
    expect(requirePositiveWholeQuantity('5', 'Laptop')).toBe(5);
  });

  it('rejects zero', () => {
    expect(() => requirePositiveWholeQuantity(0, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a negative quantity', () => {
    expect(() => requirePositiveWholeQuantity(-3, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a decimal quantity', () => {
    expect(() => requirePositiveWholeQuantity(1.5, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects NaN', () => {
    expect(() => requirePositiveWholeQuantity(NaN, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects Infinity', () => {
    expect(() => requirePositiveWholeQuantity(Infinity, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a non-numeric string', () => {
    expect(() => requirePositiveWholeQuantity('abc', 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('sets statusCode 400', () => {
    try {
      requirePositiveWholeQuantity(0, 'Laptop');
      expect.unreachable();
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
  });
});

describe('requireNonZeroWholeQuantity', () => {
  it('accepts a positive integer (stock in)', () => {
    expect(requireNonZeroWholeQuantity(5, 'Laptop')).toBe(5);
  });

  it('accepts a negative integer (stock out)', () => {
    expect(requireNonZeroWholeQuantity(-5, 'Laptop')).toBe(-5);
  });

  it('rejects zero', () => {
    expect(() => requireNonZeroWholeQuantity(0, 'Laptop')).toThrow(/non-zero whole number/);
  });

  it('rejects a decimal', () => {
    expect(() => requireNonZeroWholeQuantity(5.5, 'Laptop')).toThrow(/non-zero whole number/);
  });

  it('rejects a negative decimal', () => {
    expect(() => requireNonZeroWholeQuantity(-2.5, 'Laptop')).toThrow(/non-zero whole number/);
  });

  it('rejects NaN', () => {
    expect(() => requireNonZeroWholeQuantity(NaN, 'Laptop')).toThrow(/non-zero whole number/);
  });

  it('rejects Infinity', () => {
    expect(() => requireNonZeroWholeQuantity(Infinity, 'Laptop')).toThrow(/non-zero whole number/);
  });

  it('rejects a non-numeric string', () => {
    expect(() => requireNonZeroWholeQuantity('abc', 'Laptop')).toThrow(/non-zero whole number/);
  });

  it('sets statusCode 400', () => {
    try {
      requireNonZeroWholeQuantity(0, 'Laptop');
      expect.unreachable();
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
  });
});
