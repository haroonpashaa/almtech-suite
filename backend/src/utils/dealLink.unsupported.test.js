import { describe, expect, it, vi } from 'vitest';

vi.mock('./ledger.js', () => ({ transactionsSupported: async () => false }));

const { requireDealTransactionSupport } = await import('./dealLink.js');

describe('deal transaction availability guard', () => {
  it('fails closed with an explicit 503 on standalone MongoDB', async () => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };

    await expect(requireDealTransactionSupport(res, 'deal-id')).rejects.toThrow(/replica-set transaction support/i);

    expect(res.statusCode).toBe(503);
  });
});
