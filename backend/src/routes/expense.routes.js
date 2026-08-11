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

// Expenses are financial data, so the whole module is admin-only — the same policy
// that already governs account balances, ledgers, profit-loss and monthly summary.
// No existing role gains anything here.
const r = Router();
r.use(protect);
r.use(requireRole('admin'));

// Declared before '/:id' so the literal paths are not captured as ids.
r.get('/categories', listCategories);
r.get('/daily', dailyExpenses);
r.get('/monthly', monthlyExpenses);

r.get('/', listExpenses);
r.get('/:id', getExpense);
r.post('/', createExpense);
r.patch('/:id', updateExpense);
r.post('/:id/void', voidExpense);
export default r;
