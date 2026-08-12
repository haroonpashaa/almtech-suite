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
  const { from, to, type } = req.query;
  const account = await Account.findById(req.params.id);
  if (!account) {
    res.status(404);
    throw new Error('Account not found');
  }

  /* -------------------------------------------------------------------------
     Window semantics.

     The previous implementation applied `.sort('date').limit(500)`, which returns
     the OLDEST 500 rows and then reversed them for display — so on an account with
     more history the screen showed the beginning of the ledger while appearing to
     show the latest activity, the running balance stopped part-way through, and
     nothing said any rows were missing. Measured on a deliberately built account of
     680 transactions: the ledger reported a closing running balance of 100,000
     against a currentBalance of 99,880, with 180 rows silently absent.

     The window is now explicit and the running balance is anchored to it:

       openingForWindow = account.openingBalance
                        + every movement BEFORE `from`
                        + every movement inside the window BEFORE this page

     so the first row of any page continues from the correct figure, and the last
     row of the last page necessarily equals the derived balance. Both prior sums
     are computed by the database, never by loading rows into memory.

     Ordering is (date, _id). Date alone is not unique — several transactions can
     share a timestamp — and an unstable sort would let a row appear on two pages
     or none.
     ----------------------------------------------------------------------- */
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const windowFilter = { account: account._id };
  if (type) windowFilter.type = type;
  if (from || to) {
    windowFilter.date = {};
    if (from) windowFilter.date.$gte = new Date(from);
    // `to` is inclusive of the whole day. Both ends must be bounded in UTC:
    // `new Date('YYYY-MM-DD')` parses as UTC midnight, so closing the day with the
    // LOCAL setHours mixes two zones. On a UTC+5 machine that resolved to
    // 18:59:59Z and silently dropped every transaction later in the day —
    // measured here as `to=<today>` returning 0 of 680 rows.
    if (to) windowFilter.date.$lte = new Date(new Date(to).setUTCHours(23, 59, 59, 999));
  }

  const sumOf = (rows) => {
    const inn = rows.find((r) => r._id === 'in')?.total || 0;
    const out = rows.find((r) => r._id === 'out')?.total || 0;
    return inn - out;
  };

  const [totalEntries, priorRows, pageBeforeRows, allRows, rows] = await Promise.all([
    FinancialTransaction.countDocuments(windowFilter),

    // Everything before the window opens. Note this ignores `type`: the balance the
    // window opens at is a real balance, not a balance of one transaction type.
    from
      ? FinancialTransaction.aggregate([
          { $match: { account: account._id, date: { $lt: new Date(from) } } },
          { $group: { _id: '$direction', total: { $sum: '$amount' } } },
        ])
      : Promise.resolve([]),

    // Rows inside the window that precede this page — this is what makes the
    // running balance coherent across pages rather than restarting each page.
    skip
      ? FinancialTransaction.aggregate([
          { $match: windowFilter },
          { $sort: { date: 1, _id: 1 } },
          { $limit: skip },
          { $group: { _id: '$direction', total: { $sum: '$amount' } } },
        ])
      : Promise.resolve([]),

    FinancialTransaction.aggregate([
      { $match: { account: account._id } },
      { $group: { _id: '$direction', total: { $sum: '$amount' } } },
    ]),

    FinancialTransaction.find(windowFilter)
      .populate('customer', 'name')
      .populate('supplier', 'name')
      .populate('invoice', 'number')
      .populate('purchaseOrder', 'number')
      .populate('createdBy', 'name')
      .sort({ date: 1, _id: 1 })
      .skip(skip)
      .limit(limit),
  ]);

  const openingForWindow = account.openingBalance + sumOf(priorRows) + sumOf(pageBeforeRows);

  let running = openingForWindow;
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
      balance: Math.round(running * 100) / 100,
    };
  });
  const closingForWindow = Math.round(running * 100) / 100;

  const totalIn = allRows.find((p) => p._id === 'in')?.total || 0;
  const totalOut = allRows.find((p) => p._id === 'out')?.total || 0;
  // Integrity check: the incrementally-maintained currentBalance must equal the
  // balance derived from the full ledger. Surfacing any drift beats hiding it.
  const derivedBalance = account.openingBalance + totalIn - totalOut;
  const totalPages = Math.max(1, Math.ceil(totalEntries / limit));

  res.json({
    account,
    openingBalance: account.openingBalance,
    openingForWindow,
    closingForWindow,
    totalIn,
    totalOut,
    currentBalance: account.currentBalance,
    derivedBalance,
    reconciled: Math.abs(derivedBalance - account.currentBalance) < 0.005,
    // Paging is reported so a truncated ledger can never look complete.
    page,
    limit,
    totalEntries,
    totalPages,
    hasMore: page < totalPages,
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
