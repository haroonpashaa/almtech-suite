import { describe, it, expect } from 'vitest';
import { resolveLineComments, normalizeSaleQuantity } from './invoice.controller.js';

describe('resolveLineComments', () => {
  it('falls back to the product comments when the sale sends none', () => {
    expect(resolveLineComments(undefined, { comments: 'Screen scratch' })).toBe('Screen scratch');
  });

  it('lets the salesperson override the product comments for this sale', () => {
    expect(resolveLineComments('Sold as-is, buyer aware of the scratch', { comments: 'Screen scratch' })).toBe(
      'Sold as-is, buyer aware of the scratch'
    );
  });

  it('lets the salesperson explicitly clear the comment with an empty string', () => {
    expect(resolveLineComments('', { comments: 'Screen scratch' })).toBe('');
  });

  it('defaults to empty when neither the sale nor the product has a comment', () => {
    expect(resolveLineComments(undefined, {})).toBe('');
  });
});

describe('normalizeSaleQuantity', () => {
  it('accepts a valid positive integer', () => {
    expect(normalizeSaleQuantity(3, 'Laptop')).toBe(3);
  });

  it('rejects zero', () => {
    expect(() => normalizeSaleQuantity(0, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a negative quantity', () => {
    expect(() => normalizeSaleQuantity(-3, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a fractional quantity instead of silently truncating or flooring it', () => {
    expect(() => normalizeSaleQuantity(1.7, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a non-numeric value', () => {
    expect(() => normalizeSaleQuantity('abc', 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('sets statusCode 400 so the global error handler responds correctly', () => {
    try {
      normalizeSaleQuantity(0, 'Laptop');
      expect.unreachable();
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
  });

  it('coerces a numeric string to a number', () => {
    expect(normalizeSaleQuantity('5', 'Laptop')).toBe(5);
  });
});
