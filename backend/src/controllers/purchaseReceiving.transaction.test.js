import { expect, it, vi } from 'vitest';
import { receiveItems } from './purchaseOrder.controller.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
vi.mock('../utils/ledger.js', async original => ({ ...(await original()), transactionsSupported: vi.fn().mockResolvedValue(false) }));
it('refuses receiving without transaction support before reading or writing business records', async () => {
  const lookup = vi.spyOn(PurchaseOrder, 'findById');
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
  await expect(receiveItems({ body: { receipts: [] }, params: {}, user: {} }, res)).rejects.toThrow(/requires MongoDB transaction support/);
  expect(res.statusCode).toBe(503); expect(lookup).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
