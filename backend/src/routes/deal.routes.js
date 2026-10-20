import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { listSaleDeals, saleDeal, listPurchaseDeals, purchaseDeal } from '../controllers/deal.controller.js';
import { createDealAccount, dealOptions, getDealAccount, linkDealRecord, listDealAccounts, unlinkDealRecord } from '../controllers/dealAccounts.controller.js';

// Company-wide transaction history is financial reporting, so it follows the policy
// already applied to accounts, ledgers, expenses, receivables and payables: admin only.
//
// This does not narrow anything for Sales — their existing access to GET /invoices and
// GET /invoices/:id (including that invoice's payments) is untouched. This module only
// declines to give them the company-wide deal list and the account-attributed view.
const r = Router();
r.use(protect);

// Deal identifiers are safe for sales/stock operators to select while creating their allowed records.
r.get('/records/options', dealOptions);

r.use(requireRole('admin'));

r.get('/records', listDealAccounts);
r.post('/records', createDealAccount);
r.get('/records/:id', getDealAccount);
r.post('/records/:id/link', linkDealRecord);
r.delete('/records/:id/links/:type/:recordId', unlinkDealRecord);

r.get('/sales', listSaleDeals);
r.get('/sales/:id', saleDeal);
r.get('/purchases', listPurchaseDeals);
r.get('/purchases/:id', purchaseDeal);
export default r;
