import { buildInvoice, buildQuotation, buildPurchaseOrder, buildStatement, buildReceipt } from './documents.js';

export { buildInvoice, buildQuotation, buildPurchaseOrder, buildStatement, buildReceipt };
export { Doc } from './document.js';
export { money, amount, docDate, COLOR } from './theme.js';

/**
 * Preserved signature from before Phase 3G. The invoice PDF endpoint and its
 * frontend link both continue to work unchanged.
 */
export function streamInvoicePDF(res, { invoice, customer, settings, download = false }) {
  return buildInvoice({ invoice, customer, settings, res, download });
}
