import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listAccounts,
  accountsSummary,
  createAccount,
  updateAccount,
  accountLedger,
  reconcileAccounts,
} from '../controllers/account.controller.js';
import { accountStatementPDF } from '../controllers/document.controller.js';

const r = Router();
r.use(protect);

// Any authenticated user may list accounts (name/type only) — sales needs it to pick
// where an invoice payment landed, stock needs it for supplier payments. Balances and
// ledgers are admin-only, consistent with profit-loss and monthly-summary reports.
r.get('/', listAccounts);
r.get('/summary', requireRole('admin'), accountsSummary);
r.get('/reconcile', requireRole('admin'), reconcileAccounts);
r.get('/:id/ledger', requireRole('admin'), accountLedger);
// The printed statement is the ledger, so it stays admin-only like the ledger.
r.get('/:id/statement/pdf', requireRole('admin'), accountStatementPDF);
r.post('/', requireRole('admin'), createAccount);
r.patch('/:id', requireRole('admin'), updateAccount);
export default r;
