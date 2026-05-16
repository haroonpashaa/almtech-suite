import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  dashboard,
  dailySales,
  profitAndLoss,
  salesByProduct,
  salesByCustomer,
  receivables,
  payables,
  stockValuation,
  monthlySummary,
} from '../controllers/report.controller.js';

const r = Router();
r.use(protect);
r.get('/dashboard', dashboard);
r.get('/daily-sales', dailySales);
r.get('/profit-loss', requireRole('admin'), profitAndLoss);
r.get('/sales-by-product', salesByProduct);
r.get('/sales-by-customer', salesByCustomer);
r.get('/receivables', receivables);
r.get('/payables', payables);
r.get('/stock-valuation', requireRole('admin', 'stock'), stockValuation);
r.get('/monthly-summary', requireRole('admin'), monthlySummary);
export default r;
