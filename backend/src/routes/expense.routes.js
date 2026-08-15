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

// Sales records the day's spending and keeps it tidy; the administrator verifies it in
// the ERP afterwards, since every expense carries the user who created it and appears
// in the activity log.
//
// Voiding is the exception and stays with the administrator: it is not an edit but a
// reversing accounting entry that moves money back into the account.
//
// Worth knowing about the shape of this: an expense posts to the ledger the moment it
// is saved. There is no pending state, so verification is after the fact.
const r = Router();
r.use(protect);

const staffOrAdmin = requireRole('admin', 'sales');

// Declared before '/:id' so the literal paths are not captured as ids.
r.get('/daily', staffOrAdmin, dailyExpenses);
r.get('/monthly', staffOrAdmin, monthlyExpenses);
r.get('/categories', staffOrAdmin, listCategories);

r.get('/', staffOrAdmin, listExpenses);
r.get('/:id', staffOrAdmin, getExpense);
r.post('/', staffOrAdmin, createExpense);
r.patch('/:id', staffOrAdmin, updateExpense);
r.post('/:id/void', requireRole('admin'), voidExpense);
export default r;
