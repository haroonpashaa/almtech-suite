import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { recentPayments } from '../controllers/payment.controller.js';

const r = Router();
r.use(protect);
// Every posted transaction across every account, customer and supplier — the same
// company-wide financial history Ledger Reports' Payment History tab and Dashboard
// already show only to admin. Both callers were already admin-gated in the
// frontend; this closes the same endpoint against a direct API call.
r.get('/', requireRole('admin'), recentPayments);
export default r;
