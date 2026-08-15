import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Expense, { EXPENSE_CATEGORIES } from '../models/Expense.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import { logActivity } from '../utils/activity.js';
import { postPaymentAtomically, resolveAccount, rethrowDuplicatePosting } from '../utils/ledger.js';

export const listCategories = asyncHandler(async (_req, res) => {
  res.json(EXPENSE_CATEGORIES);
});

function buildFilter(query) {
  const { from, to, category, account, status = 'posted' } = query;
  const filter = {};
  if (status !== 'all') filter.status = status;
  if (category) filter.category = category;
  if (account && mongoose.isValidObjectId(account)) filter.account = account;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to) filter.date.$lte = new Date(to);
  }
  return filter;
}

// List + totals for exactly the filtered set, so the figure on screen always matches
// the rows on screen.
export const listExpenses = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);
  const limit = Math.min(Number(req.query.limit) || 500, 1000);

  const [items, totals, byCategory] = await Promise.all([
    Expense.find(filter).populate('account', 'name type').populate('createdBy', 'name').sort('-date').limit(limit),
    Expense.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Expense.aggregate([
      { $match: filter },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  res.json({
    items,
    total: totals[0]?.total || 0,
    count: totals[0]?.count || 0,
    byCategory: byCategory.map((c) => ({ category: c._id, total: c.total, count: c.count })),
  });
});

export const getExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id)
    .populate('account', 'name type')
    .populate('createdBy', 'name')
    .populate('updatedBy', 'name')
    .populate('voidedBy', 'name')
    .populate('financialTransaction')
    .populate('reversalTransaction');
  if (!expense) {
    res.status(404);
    throw new Error('Expense not found');
  }
  res.json(expense);
});

export const createExpense = asyncHandler(async (req, res) => {
  const { amount, category, account: accountId, date, description, notes, reference, idempotencyKey } = req.body;

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    res.status(400);
    throw new Error('Expense amount must be greater than zero');
  }
  if (!category || !EXPENSE_CATEGORIES.includes(category)) {
    res.status(400);
    throw new Error(`Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`);
  }
  // Rejects missing, malformed, unknown and inactive accounts — the same validation
  // invoice and supplier payments use.
  const account = await resolveAccount(res, accountId);

  const when = date ? new Date(date) : new Date();
  if (Number.isNaN(when.getTime())) {
    res.status(400);
    throw new Error('Invalid expense date');
  }

  // The expense id is generated up front so the ledger row and the expense reference
  // each other from the moment each is written — no second pass to back-fill a link
  // that could fail halfway.
  const expenseId = new mongoose.Types.ObjectId();

  let expense;
  try {
    await postPaymentAtomically(
      {
        account: account._id,
        amount: numericAmount,
        direction: 'out',
        type: 'expense',
        method: account.type === 'cash' ? 'cash' : 'bank',
        reference,
        description: description || `${category} expense`,
        expense: expenseId,
        date: when,
        createdBy: req.user._id,
        idempotencyKey,
      },
      async (session, posted) => {
        const [created] = await Expense.create(
          [
            {
              _id: expenseId,
              amount: numericAmount,
              category,
              account: account._id,
              date: when,
              description,
              notes,
              reference,
              status: 'posted',
              financialTransaction: posted._id,
              createdBy: req.user._id,
            },
          ],
          session ? { session } : {}
        );
        expense = created;
      }
    );
  } catch (e) {
    rethrowDuplicatePosting(e, res);
  }

  await logActivity(req, 'expense_created', {
    entity: 'Expense',
    entityId: expense._id,
    meta: { amount: numericAmount, category, account: account.name },
  });
  res.status(201).json(await expense.populate('account', 'name type'));
});

// Posted expenses are financially immutable: amount, account and date can never be
// edited in place, because doing so would silently desynchronise the ledger row that
// already moved the money. Only descriptive fields may be corrected — and category,
// which is a reporting classification, not a movement. To change money, void and
// re-record.
const IMMUTABLE_FIELDS = ['amount', 'account', 'date'];

export const updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) {
    res.status(404);
    throw new Error('Expense not found');
  }
  if (expense.status === 'voided') {
    res.status(400);
    throw new Error('This expense has been voided and can no longer be edited');
  }

  const attempted = IMMUTABLE_FIELDS.filter((f) => req.body[f] !== undefined);
  if (attempted.length) {
    res.status(400);
    throw new Error(
      `Cannot change ${attempted.join(', ')} on a posted expense — the money has already left the account. ` +
        'Void this expense and record a corrected one instead.'
    );
  }

  const { category, description, notes, reference } = req.body;
  if (category !== undefined) {
    if (!EXPENSE_CATEGORIES.includes(category)) {
      res.status(400);
      throw new Error(`Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`);
    }
    expense.category = category;
  }
  if (description !== undefined) expense.description = description;
  if (notes !== undefined) expense.notes = notes;
  if (reference !== undefined) expense.reference = reference;
  expense.updatedBy = req.user._id;
  await expense.save();

  // Keep the ledger row's descriptive fields in step. This touches no amount,
  // account, direction or date, so no balance can move.
  await FinancialTransaction.updateOne(
    { _id: expense.financialTransaction },
    { $set: { description: expense.description || `${expense.category} expense`, reference: expense.reference } }
  );

  await logActivity(req, 'expense_updated', { entity: 'Expense', entityId: expense._id });
  res.json(await expense.populate('account', 'name type'));
});

// The only way to undo a posted expense. Nothing is deleted: the original ledger row
// stays, and a matching reversing row returns the money to the account, so the audit
// trail shows both movements and the account balance ends up where it started.
export const voidExpense = asyncHandler(async (req, res) => {
  const { reason, idempotencyKey } = req.body;
  const expense = await Expense.findById(req.params.id).populate('account', 'name type active');
  if (!expense) {
    res.status(404);
    throw new Error('Expense not found');
  }
  if (expense.status === 'voided') {
    res.status(400);
    throw new Error('This expense has already been voided');
  }

  try {
    await postPaymentAtomically(
      {
        account: expense.account._id,
        amount: expense.amount,
        direction: 'in',
        type: 'expense_reversal',
        reference: expense.reference,
        description: `Reversal of ${expense.category} expense${reason ? ` — ${reason}` : ''}`,
        expense: expense._id,
        createdBy: req.user._id,
        idempotencyKey,
      },
      async (session, posted) => {
        expense.status = 'voided';
        expense.reversalTransaction = posted._id;
        expense.voidedAt = new Date();
        expense.voidedBy = req.user._id;
        expense.voidReason = reason;
        await expense.save({ session });
      }
    );
  } catch (e) {
    rethrowDuplicatePosting(e, res);
  }

  await logActivity(req, 'expense_voided', {
    entity: 'Expense',
    entityId: expense._id,
    meta: { amount: expense.amount, category: expense.category, reason },
  });
  res.json(expense);
});

// ---------------------------------------------------------------------------
// Reports — every figure is aggregated from Expense records at query time. There are
// no stored daily/monthly totals to drift out of date.
// ---------------------------------------------------------------------------

export const dailyExpenses = asyncHandler(async (req, res) => {
  const day = req.query.date ? new Date(req.query.date) : new Date();
  if (Number.isNaN(day.getTime())) {
    res.status(400);
    throw new Error('Invalid date');
  }
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start.getTime() + 86400000);
  const match = { status: 'posted', date: { $gte: start, $lt: end } };

  const [byCategory, items] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.find(match).populate('account', 'name type').populate('createdBy', 'name').sort('date'),
  ]);

  res.json({
    date: start,
    byCategory: byCategory.map((c) => ({ category: c._id, total: c.total, count: c.count })),
    items,
    total: byCategory.reduce((s, c) => s + c.total, 0),
    count: items.length,
  });
});

export const monthlyExpenses = asyncHandler(async (req, res) => {
  // Accepts YYYY-MM; defaults to the current month.
  const raw = req.query.month;
  const base = raw ? new Date(`${raw}-01T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    res.status(400);
    throw new Error('Invalid month (expected YYYY-MM)');
  }
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const match = { status: 'posted', date: { $gte: start, $lt: end } };

  const [byCategory, byDay, byAccount] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$account', total: { $sum: '$amount' } } },
      { $lookup: { from: 'accounts', localField: '_id', foreignField: '_id', as: 'account' } },
      { $unwind: '$account' },
      { $project: { _id: 0, account: '$account.name', total: 1 } },
      { $sort: { total: -1 } },
    ]),
  ]);

  res.json({
    month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
    from: start,
    to: end,
    byCategory: byCategory.map((c) => ({ category: c._id, total: c.total, count: c.count })),
    byDay: byDay.map((d) => ({ date: d._id, total: d.total, count: d.count })),
    byAccount,
    total: byCategory.reduce((s, c) => s + c.total, 0),
  });
});
