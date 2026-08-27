import { describe, it, expect } from 'vitest';
import { stripCostInput } from './product.controller.js';

describe('stripCostInput', () => {
  it('strips purchasePrice for a sales user', () => {
    const req = { user: { role: 'sales' } };
    expect(stripCostInput(req, { name: 'X', purchasePrice: 5000, sellingPrice: 9000 })).toEqual({
      name: 'X', sellingPrice: 9000,
    });
  });

  it('keeps purchasePrice for admin and stock', () => {
    const payload = { name: 'X', purchasePrice: 5000 };
    expect(stripCostInput({ user: { role: 'admin' } }, payload)).toEqual(payload);
    expect(stripCostInput({ user: { role: 'stock' } }, payload)).toEqual(payload);
  });

  it('is a no-op when purchasePrice is already absent', () => {
    const req = { user: { role: 'sales' } };
    expect(stripCostInput(req, { name: 'X' })).toEqual({ name: 'X' });
  });
});
