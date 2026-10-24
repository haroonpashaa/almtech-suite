// Temporary write policy. Historical schemas, amounts and currency labels are retained.
export function requireSupportedCurrency(currency = 'PKR') {
  if (currency !== 'PKR') {
    const error = new Error('Only PKR is supported for new financial entries. Historical foreign-currency records retain their original currency and amounts.');
    error.statusCode = 400;
    throw error;
  }
}
