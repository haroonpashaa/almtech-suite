const PROVIDER = 'ExchangeRate-API';
const ENDPOINT = 'https://v6.exchangerate-api.com/v6/latest';
const cache = new Map();
const inFlight = new Map();

export class RateUnavailableError extends Error {
  constructor(message = 'A current exchange rate is unavailable. Try again later.') {
    super(message);
    this.name = 'RateUnavailableError';
    this.statusCode = 503;
  }
}

export function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function convertAmount(amount, rate) {
  return roundCurrency(Number(amount) * Number(rate));
}

export async function fetchRateTable(baseCurrency, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!['GBP', 'PKR'].includes(baseCurrency)) throw new RateUnavailableError('Only GBP and PKR exchange rates are supported.');
  const cached = cache.get(baseCurrency);
  if (cached && now < cached.validUntil) return cached;

  const key = process.env.EXCHANGE_RATE_API_KEY;
  if (!key) throw new RateUnavailableError('Exchange-rate service is not configured. Contact an administrator.');
  if (inFlight.has(baseCurrency)) return inFlight.get(baseCurrency);
  const pending = (async () => {
    let response;
    try {
      response = await fetchImpl(`${ENDPOINT}/${baseCurrency}`, {
        signal: AbortSignal.timeout(5000),
        // Provider-supported bearer auth keeps the secret out of request URLs,
        // which are more likely to be retained by proxy/access logs.
        headers: { accept: 'application/json', authorization: `Bearer ${key}` },
      });
    } catch {
      throw new RateUnavailableError();
    }
    if (!response.ok) throw new RateUnavailableError();
    let payload;
    try { payload = await response.json(); } catch { throw new RateUnavailableError(); }
    const lastUpdate = Number(payload.time_last_update_unix) * 1000;
    const nextUpdate = Number(payload.time_next_update_unix) * 1000;
    if (payload.result !== 'success' || payload.base_code !== baseCurrency || !Number.isFinite(lastUpdate) || !Number.isFinite(nextUpdate) || now >= nextUpdate) {
      throw new RateUnavailableError();
    }
    const rates = payload.conversion_rates || payload.rates;
    if (!rates || !Number.isFinite(Number(rates.GBP)) || !Number.isFinite(Number(rates.PKR)) || Number(rates.GBP) <= 0 || Number(rates.PKR) <= 0) {
      throw new RateUnavailableError('The rate provider did not return both GBP and PKR rates.');
    }
    const table = {
      baseCurrency,
      rates: { GBP: Number(rates.GBP), PKR: Number(rates.PKR) },
      effectiveAt: new Date(lastUpdate),
      validUntil: nextUpdate,
      source: PROVIDER,
      sourceIdentifier: `exchangerate-api:${baseCurrency}`,
    };
    cache.set(baseCurrency, table);
    return table;
  })();
  inFlight.set(baseCurrency, pending);
  try { return await pending; }
  finally { if (inFlight.get(baseCurrency) === pending) inFlight.delete(baseCurrency); }
}

export async function getCurrentRate(fromCurrency, toCurrency, options) {
  if (!['GBP', 'PKR'].includes(fromCurrency) || !['GBP', 'PKR'].includes(toCurrency)) {
    throw new RateUnavailableError('Only GBP and PKR exchange rates are supported.');
  }
  if (fromCurrency === toCurrency) {
    const now = options?.now ?? Date.now();
    return { fromCurrency, toCurrency, rate: 1, effectiveAt: new Date(now), validUntil: now + 60_000, source: 'identity', sourceIdentifier: 'identity:1:1' };
  }
  const table = await fetchRateTable(fromCurrency, options);
  return {
    fromCurrency,
    toCurrency,
    rate: table.rates[toCurrency],
    effectiveAt: table.effectiveAt,
    validUntil: table.validUntil,
    source: table.source,
    sourceIdentifier: table.sourceIdentifier,
  };
}

export async function createRateSnapshot(amount, fromCurrency, toCurrency, options) {
  const quote = await getCurrentRate(fromCurrency, toCurrency, options);
  return {
    ...quote,
    originalAmount: roundCurrency(amount),
    equivalentAmount: convertAmount(amount, quote.rate),
    fetchedAt: new Date(options?.now ?? Date.now()),
  };
}

export function clearRateCacheForTests() {
  cache.clear();
  inFlight.clear();
}
