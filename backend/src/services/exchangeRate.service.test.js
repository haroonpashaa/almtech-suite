import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRateCacheForTests, convertAmount, createRateSnapshot, fetchRateTable, getCurrentRate, RateUnavailableError } from './exchangeRate.service.js';

const originalKey = process.env.EXCHANGE_RATE_API_KEY;
const now = Date.UTC(2026, 9, 20, 12);
const payload = (base, rates, next = now + 86_400_000) => ({
  result: 'success', base_code: base, conversion_rates: rates,
  time_last_update_unix: Math.floor((now - 60_000) / 1000),
  time_next_update_unix: Math.floor(next / 1000),
});

afterEach(() => {
  clearRateCacheForTests();
  if (originalKey === undefined) delete process.env.EXCHANGE_RATE_API_KEY;
  else process.env.EXCHANGE_RATE_API_KEY = originalKey;
  vi.restoreAllMocks();
});

describe('exchange rate service', () => {
  it('loads GBP to PKR rates and stores provider source and effective time in the snapshot', async () => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => payload('GBP', { GBP: 1, PKR: 365.125 }) }));
    const snapshot = await createRateSnapshot(12.34, 'GBP', 'PKR', { fetchImpl, now });
    expect(snapshot).toMatchObject({ fromCurrency: 'GBP', toCurrency: 'PKR', rate: 365.125, originalAmount: 12.34, equivalentAmount: 4505.64, source: 'ExchangeRate-API' });
    expect(snapshot.effectiveAt).toEqual(new Date(now - 60_000));
    expect(snapshot.fetchedAt).toEqual(new Date(now));
    expect(fetchImpl.mock.calls[0][0]).toBe('https://v6.exchangerate-api.com/v6/latest/GBP');
    expect(fetchImpl.mock.calls[0][0]).not.toContain('test-only-key');
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer test-only-key');
  });

  it('supports PKR to GBP and rounds conversions to currency minor units', async () => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => payload('PKR', { GBP: 0.002738, PKR: 1 }) }));
    const quote = await getCurrentRate('PKR', 'GBP', { fetchImpl, now });
    expect(quote.rate).toBe(0.002738);
    expect(convertAmount(1000, quote.rate)).toBe(2.74);
  });

  it('rejects provider failures, missing configuration and expired response rates', async () => {
    delete process.env.EXCHANGE_RATE_API_KEY;
    await expect(getCurrentRate('GBP', 'PKR', { now })).rejects.toBeInstanceOf(RateUnavailableError);
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    await expect(fetchRateTable('GBP', { now, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) })).rejects.toBeInstanceOf(RateUnavailableError);
    await expect(fetchRateTable('GBP', { now, fetchImpl: async () => ({ ok: true, json: async () => payload('GBP', { GBP: 1, PKR: 300 }, now) }) })).rejects.toBeInstanceOf(RateUnavailableError);
  });

  it('uses the cached quote only until provider next-update time', async () => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => payload('GBP', { GBP: 1, PKR: 300 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => payload('GBP', { GBP: 1, PKR: 301 }, now + 2 * 86_400_000) });
    await getCurrentRate('GBP', 'PKR', { fetchImpl, now });
    await getCurrentRate('GBP', 'PKR', { fetchImpl, now: now + 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await getCurrentRate('GBP', 'PKR', { fetchImpl, now: now + 86_400_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests for the same currency pair', async () => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    const fetchImpl = vi.fn(async () => {
      await Promise.resolve();
      return { ok: true, json: async () => payload('GBP', { GBP: 1, PKR: 300 }) };
    });
    const [first, second] = await Promise.all([
      getCurrentRate('GBP', 'PKR', { fetchImpl, now }),
      getCurrentRate('GBP', 'PKR', { fetchImpl, now }),
    ]);
    expect(first.rate).toBe(second.rate);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
