import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  voidExpense,
  listCategories,
  dailyExpenses,
  monthlyExpenses,
} from '../controllers/expense.controller.js';

// Expenses are financial data and stay with the administrator: listing them, creating,
// editing and voiding are all admin-only.
//
// The two reporting endpoints are the deliberate exception. They return totals — by
// category, by day, by account — which the sales team needs for its own reporting.
// dailyExpenses additionally withholds the itemised rows from a non-administrator, so
// a sales user sees what was spent in total without seeing each individual payment.
const r = Router();
r.use(protect);

// Declared before '/:id' so the literal paths are not captured as ids.
r.get('/daily', requireRole('admin', 'sales'), dailyExpenses);
r.get('/monthly', requireRole('admin', 'sales'), monthlyExpenses);

r.use(requireRole('admin'));
r.get('/categories', listCategories);

r.get('/', listExpenses);
r.get('/:id', getExpense);
r.post('/', createExpense);
r.patch('/:id', updateExpense);
r.post('/:id/void', voidExpense);
export default r;
