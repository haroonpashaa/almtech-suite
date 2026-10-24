// Stock mutations must invalidate every view of the same Product.stock field.
// Navigation flows can mark stale without waiting for background network reads.
export function invalidateInventory(client, refetchType = 'active') {
  for (const key of ['products', 'product', 'products-pos', 'products-po', 'product-models', 'products-pos-models', 'dashboard']) {
    client.invalidateQueries({ queryKey: [key], refetchType });
  }
}


export function invalidateSale(client) {
  invalidateInventory(client, 'none');
  for (const key of ['invoices', 'customer', 'customers', 'customer-ledger', 'receivable', 'receivables', 'finance-position', 'accounts-summary', 'account-ledger', 'payment-history', 'report-series', 'report-series-prev', 'report-series-daily', 'dash-pl', 'dash-payments', 'dash-receivables', 'deal', 'deal-accounts']) {
    client.invalidateQueries({ queryKey: [key], refetchType: 'none' });
  }
}
