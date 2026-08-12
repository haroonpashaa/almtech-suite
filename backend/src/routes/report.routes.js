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
  series,
  inventoryReconcile,
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
// Chart series for the dashboard — financial data, so admin-only like profit-loss.
r.get('/series', requireRole('admin'), series);
// Read-only integrity check; admin-only like the other reconciliation endpoints.
r.get('/inventory-reconcile', requireRole('admin'), inventoryReconcile);
export default r;
