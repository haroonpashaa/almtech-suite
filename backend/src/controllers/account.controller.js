import asyncHandler from 'express-async-handler';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import { logActivity } from '../utils/activity.js';

// Selector feed. Deliberately excludes balances: every role that can record a
// payment needs the list of accounts to choose from, but only admins should see how
// much money sits in each. Balances come from /accounts/summary (admin-only).
export const listAccounts = asyncHandler(async (req, res) => {
  const filter = req.query.includeInactive === 'true' ? {} : { active: true };
  const accounts = await Account.find(filter).select('name type active sortOrder').sort('sortOrder name');
  res.json(accounts);
});

// Admin-only: full records including balances, plus a company-wide total.
export const accountsSummary = asyncHandler(async (_req, res) => {
  const accounts = await Account.find().sort('sortOrder name');
  const total = accounts.filter((a) => a.active).reduce((s, a) => s + a.currentBalance, 0);
  res.json({ accounts, total });
});

export const createAccount = asyncHandler(async (req, res) => {
  const { name, type, openingBalance = 0, bankName, accountNumber, accountTitle, sortOrder, notes } = req.body;
  if (!name?.trim()) {
    res.status(400);
    throw new Error('Account name is required');
  }
  const existing = await Account.findOne({ name: name.trim() });
  if (existing) {
    res.status(409);
    throw new Error(`An account named "${name.trim()}" already exists`);
  }
  // A new account starts at its opening balance; every later movement is a ledger row.
  const account = await Account.create({
    name: name.trim(),
    type,
    openingBalance: Number(openingBalance) || 0,
    currentBalance: Number(openingBalance) || 0,
    bankName,
    accountNumber,
    accountTitle,
    sortOrder,
    notes,
  });
  await logActivity(req, 'account_created', { entity: 'Account', entityId: account._id, meta: { name: account.name } });
  res.status(201).json(account);
});

export const updateAccount = asyncHandler(async (req, res) => {
  // currentBalance is never client-writable — it only moves through ledger postings,
  // so a payment can't be bypassed by editing a balance directly.
  const { name, type, bankName, accountNumber, accountTitle, active, sortOrder, notes, openingBalance } = req.body;
  const account = await Account.findById(req.params.id);
  if (!account) {
    res.status(404);
    throw new Error('Account not found');
  }
  if (name !== undefined) account.name = name.trim();
  if (type !== undefined) account.type = type;
  if (bankName !== undefined) account.bankName = bankName;
  if (accountNumber !== undefined) account.accountNumber = accountNumber;
  if (accountTitle !== undefined) account.accountTitle = accountTitle;
  if (active !== undefined) account.active = active;
  if (sortOrder !== undefined) account.sortOrder = sortOrder;
  if (notes !== undefined) account.notes = notes;
  // Correcting the opening balance shifts the current balance by the same delta so
  // the invariant openingBalance + sum(ledger) == currentBalance still holds.
  if (openingBalance !== undefined) {
    const delta = (Number(openingBalance) || 0) - account.openingBalance;
    account.openingBalance = Number(openingBalance) || 0;
    account.currentBalance += delta;
  }
  await account.save();
  await logActivity(req, 'account_updated', { entity: 'Account', entityId: account._id });
  res.json(account);
});

// Ledger for one account: opening balance, every movement oldest-first with a
// running balance, and the closing balance.
//
// The running balance is computed here from the ordered rows rather than stored on
// each transaction. A stored balanceAfter would be wrong the moment a transaction is
// backdated or two postings interleave; recomputing keeps the column consistent with
// the order actually displayed.
export const accountLedger = asyncHandler(async (req, res) => {
  const { from, to, type, limit = 500 } = req.query;
  const account = await Account.findById(req.params.id);
  if (!account) {
    res.status(404);
    throw new Error('Account not found');
  }

  const filter = { account: account._id };
  if (type) filter.type = type;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to) filter.date.$lte = new Date(to);
  }

  const rows = await FinancialTransaction.find(filter)
    .populate('customer', 'name')
    .populate('supplier', 'name')
    .populate('invoice', 'number')
    .populate('purchaseOrder', 'number')
    .populate('createdBy', 'name')
    .sort('date')
    .limit(Number(limit));

  // Movements before the window still count toward the balance the window opens at.
  const priorFilter = { account: account._id };
  if (from) priorFilter.date = { $lt: new Date(from) };
  const prior = from
    ? await FinancialTransaction.aggregate([
        { $match: priorFilter },
        { $group: { _id: '$direction', total: { $sum: '$amount' } } },
      ])
    : [];
  const priorIn = prior.find((p) => p._id === 'in')?.total || 0;
  const priorOut = prior.find((p) => p._id === 'out')?.total || 0;

  let running = account.openingBalance + priorIn - priorOut;
  const openingForWindow = running;
  const entries = rows.map((t) => {
    running += t.direction === 'in' ? t.amount : -t.amount;
    return {
      _id: t._id,
      date: t.date,
      type: t.type,
      direction: t.direction,
      amount: t.amount,
      description: t.description,
      reference: t.reference,
      method: t.method,
      customer: t.customer?.name,
      supplier: t.supplier?.name,
      invoice: t.invoice?.number,
      invoiceId: t.invoice?._id,
      purchaseOrder: t.purchaseOrder?.number,
      purchaseOrderId: t.purchaseOrder?._id,
      user: t.createdBy?.name,
      balance: running,
    };
  });

  // Integrity check: the incrementally-maintained currentBalance must equal the
  // balance derived from the full ledger. Surfacing any drift beats hiding it.
  const all = await FinancialTransaction.aggregate([
    { $match: { account: account._id } },
    { $group: { _id: '$direction', total: { $sum: '$amount' } } },
  ]);
  const totalIn = all.find((p) => p._id === 'in')?.total || 0;
  const totalOut = all.find((p) => p._id === 'out')?.total || 0;
  const derivedBalance = account.openingBalance + totalIn - totalOut;

  res.json({
    account,
    openingBalance: account.openingBalance,
    openingForWindow,
    totalIn,
    totalOut,
    currentBalance: account.currentBalance,
    derivedBalance,
    reconciled: Math.abs(derivedBalance - account.currentBalance) < 0.005,
    entries: entries.reverse(), // newest first for display
  });
});

// Recomputes every account's currentBalance from its ledger and reports drift.
// Read-only unless ?fix=true, so it is safe to call for a health check.
export const reconcileAccounts = asyncHandler(async (req, res) => {
  const accounts = await Account.find();
  const sums = await FinancialTransaction.aggregate([
    { $group: { _id: { account: '$account', direction: '$direction' }, total: { $sum: '$amount' } } },
  ]);
  const report = [];
  for (const a of accounts) {
    const inSum = sums.find((s) => String(s._id.account) === String(a._id) && s._id.direction === 'in')?.total || 0;
    const outSum = sums.find((s) => String(s._id.account) === String(a._id) && s._id.direction === 'out')?.total || 0;
    const derived = a.openingBalance + inSum - outSum;
    const drift = Math.round((derived - a.currentBalance) * 100) / 100;
    if (drift !== 0 && req.query.fix === 'true') {
      a.currentBalance = derived;
      await a.save();
    }
    report.push({ account: a.name, stored: a.currentBalance, derived, drift, fixed: drift !== 0 && req.query.fix === 'true' });
  }
  res.json({ ok: report.every((r) => r.drift === 0 || r.fixed), accounts: report });
});
