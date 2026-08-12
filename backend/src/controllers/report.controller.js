import asyncHandler from 'express-async-handler';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import Account from '../models/Account.js';
import Expense from '../models/Expense.js';
import PurchaseOrder from '../models/PurchaseOrder.js';

function dateRange(from, to) {
  const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const t = to ? new Date(to) : new Date();
  return { $gte: f, $lte: t };
}

export const dashboard = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [salesToday, salesWeek, salesMonth, receivables, payables, lowStock, recentInvoices, topProducts, dailySeries] =
    await Promise.all([
      Invoice.aggregate([
        { $match: { issuedAt: { $gte: startOfDay }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]),
      Invoice.aggregate([
        { $match: { issuedAt: { $gte: startOfWeek }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Invoice.aggregate([
        { $match: { issuedAt: { $gte: startOfMonth }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Customer.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]),
      Supplier.aggregate([{ $group: { _id: null, total: { $sum: '$payable' } } }]),
      Product.find({ active: true, $expr: { $lte: ['$stock', '$lowStockThreshold'] } })
        .sort('stock')
        .limit(10),
      Invoice.find({ status: { $ne: 'cancelled' } })
        .populate('customer', 'name company')
        .sort('-issuedAt')
        .limit(8),
      Invoice.aggregate([
        { $match: { issuedAt: { $gte: startOfWeek }, status: { $ne: 'cancelled' } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            sku: { $first: '$items.sku' },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
      Invoice.aggregate([
        { $match: { issuedAt: { $gte: new Date(Date.now() - 30 * 86400000) }, status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$issuedAt' } },
            total: { $sum: '$total' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

  // Account balances are financial data, so they follow the same rule as the
  // profit-loss and monthly-summary reports: admin only. Other roles get the exact
  // dashboard payload they got before, with the key absent.
  const accounts =
    req.user?.role === 'admin'
      ? await Account.find({ active: true }).select('name type currentBalance').sort('sortOrder name')
      : undefined;

  // Expense figures follow the same admin-only visibility rule as account balances.
  let expensesToday = 0;
  let expensesMonth = 0;
  if (req.user?.role === 'admin') {
    const [todayAgg, monthAgg] = await Promise.all([
      Expense.aggregate([
        { $match: { status: 'posted', date: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: { status: 'posted', date: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    expensesToday = todayAgg[0]?.total || 0;
    expensesMonth = monthAgg[0]?.total || 0;
  }

  res.json({
    salesToday: { total: salesToday[0]?.total || 0, count: salesToday[0]?.count || 0 },
    salesWeek: salesWeek[0]?.total || 0,
    salesMonth: salesMonth[0]?.total || 0,
    receivables: receivables[0]?.total || 0,
    payables: payables[0]?.total || 0,
    lowStock,
    recentInvoices,
    topProducts,
    dailySeries,
    ...(accounts
      ? {
          accounts,
          accountsTotal: accounts.reduce((s, a) => s + a.currentBalance, 0),
          expensesToday,
          expensesMonth,
          // Money owed to the business minus money it owes. Not profit.
          netPosition: (receivables[0]?.total || 0) - (payables[0]?.total || 0),
        }
      : {}),
  });
});

export const dailySales = asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(req.query.date) : new Date();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getTime() + 86400000);
  const invoices = await Invoice.find({ issuedAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } })
    .populate('customer', 'name')
    .sort('issuedAt');
  const totals = invoices.reduce(
    (acc, inv) => {
      acc.gross += inv.total;
      acc.paid += inv.paid;
      acc.outstanding += inv.balance;
      return acc;
    },
    { gross: 0, paid: 0, outstanding: 0 }
  );
  res.json({ date: start, invoiceCount: invoices.length, ...totals, invoices });
});

export const profitAndLoss = asyncHandler(async (req, res) => {
  const issuedAt = dateRange(req.query.from, req.query.to);
  const pipeline = [
    { $match: { issuedAt, status: { $nin: ['cancelled', 'returned'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$items.lineTotal' },
        cost: { $sum: { $multiply: ['$items.quantity', '$items.unitCost'] } },
      },
    },
  ];
  // Operating expenses come from Expense records only — never from the ledger. Each
  // expense has exactly one FinancialTransaction, so summing both would double-count
  // it. `cost` above is cost-of-goods-sold from invoice lines and does not overlap
  // with operating expenses, so gross profit is unchanged from before Change 4.
  const [[result], expenseAgg, expenseByCategory] = await Promise.all([
    Invoice.aggregate(pipeline),
    Expense.aggregate([
      { $match: { status: 'posted', date: issuedAt } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: { status: 'posted', date: issuedAt } },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  const revenue = result?.revenue || 0;
  const cost = result?.cost || 0;
  const grossProfit = revenue - cost;
  const expenses = expenseAgg[0]?.total || 0;

  res.json({
    from: issuedAt.$gte,
    to: issuedAt.$lte,
    revenue,
    cost,
    grossProfit,
    margin: revenue ? Math.round(((revenue - cost) / revenue) * 10000) / 100 : 0,
    expenses,
    expensesByCategory: expenseByCategory.map((c) => ({ category: c._id, total: c.total })),
    netProfit: grossProfit - expenses,
    netMargin: revenue ? Math.round(((grossProfit - expenses) / revenue) * 10000) / 100 : 0,
  });
});

export const salesByProduct = asyncHandler(async (req, res) => {
  const issuedAt = dateRange(req.query.from, req.query.to);
  const pipeline = [
    { $match: { issuedAt, status: { $nin: ['cancelled', 'returned'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        name: { $first: '$items.name' },
        sku: { $first: '$items.sku' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { revenue: -1 } },
  ];
  res.json(await Invoice.aggregate(pipeline));
});

export const salesByCustomer = asyncHandler(async (req, res) => {
  const issuedAt = dateRange(req.query.from, req.query.to);
  const pipeline = [
    { $match: { issuedAt, status: { $nin: ['cancelled', 'returned'] } } },
    {
      $group: {
        _id: '$customer',
        invoices: { $sum: 1 },
        revenue: { $sum: '$total' },
      },
    },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: '$customer' },
    {
      $project: {
        _id: 1,
        invoices: 1,
        revenue: 1,
        name: '$customer.name',
        company: '$customer.company',
      },
    },
    { $sort: { revenue: -1 } },
  ];
  res.json(await Invoice.aggregate(pipeline));
});

export const receivables = asyncHandler(async (_req, res) => {
  const customers = await Customer.find({ balance: { $gt: 0 } }).sort('-balance');
  res.json(customers);
});

export const payables = asyncHandler(async (_req, res) => {
  const suppliers = await Supplier.find({ payable: { $gt: 0 } }).sort('-payable');
  res.json(suppliers);
});

export const stockValuation = asyncHandler(async (_req, res) => {
  const products = await Product.find({ active: true });
  const summary = products.reduce(
    (acc, p) => {
      acc.cost += p.stock * p.purchasePrice;
      acc.retail += p.stock * p.sellingPrice;
      acc.units += p.stock;
      return acc;
    },
    { cost: 0, retail: 0, units: 0 }
  );
  res.json({ ...summary, products: products.length });
});

export const monthlySummary = asyncHandler(async (_req, res) => {
  const from = new Date();
  from.setMonth(from.getMonth() - 11);
  from.setDate(1);
  const pipeline = [
    { $match: { issuedAt: { $gte: from }, status: { $nin: ['cancelled', 'returned'] } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$issuedAt' } },
        revenue: { $sum: '$items.lineTotal' },
        cost: { $sum: { $multiply: ['$items.quantity', '$items.unitCost'] } },
      },
    },
    { $sort: { _id: 1 } },
  ];
  const data = await Invoice.aggregate(pipeline);
  res.json(data.map((d) => ({ month: d._id, revenue: d.revenue, cost: d.cost, grossProfit: d.revenue - d.cost })));
});

// ---------------------------------------------------------------------------
// Time series for dashboard charts.
//
// Read-only, and deliberately built from the SAME records and the SAME
// inclusion rules the existing reports already use, so a chart can never tell a
// different story from the numbers beside it:
//
//   revenue    Invoice.items.lineTotal, excluding cancelled/returned — identical
//              to the profitAndLoss revenue aggregation.
//   expenses   Expense.amount where status === 'posted' — identical to the
//              profitAndLoss expense aggregation and to /expenses reporting.
//   purchases  PurchaseOrder.total, excluding cancelled/draft — the same set
//              payables treats as real.
//
// It stores nothing, caches nothing and computes no balance. Summing any series
// over a range returns exactly what /reports/profit-loss reports for that range,
// which the Change 11 tests assert directly.
// ---------------------------------------------------------------------------
export const series = asyncHandler(async (req, res) => {
  const { granularity = 'day' } = req.query;
  const fmt = granularity === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const range = dateRange(req.query.from, req.query.to);

  const bucket = (dateField) => [
    { $group: { _id: { $dateToString: { format: fmt, date: `$${dateField}` } }, total: { $sum: '$__amount' } } },
    { $sort: { _id: 1 } },
  ];

  const [revenueRows, expenseRows, purchaseRows] = await Promise.all([
    Invoice.aggregate([
      { $match: { issuedAt: range, status: { $nin: ['cancelled', 'returned'] } } },
      { $unwind: '$items' },
      { $addFields: { __amount: '$items.lineTotal' } },
      ...bucket('issuedAt'),
    ]),
    Expense.aggregate([
      { $match: { status: 'posted', date: range } },
      { $addFields: { __amount: '$amount' } },
      ...bucket('date'),
    ]),
    PurchaseOrder.aggregate([
      { $match: { orderedAt: range, status: { $nin: ['cancelled', 'draft'] } } },
      { $addFields: { __amount: '$total' } },
      ...bucket('orderedAt'),
    ]),
  ]);

  // Merge onto a single set of buckets so the chart never has ragged series.
  const keys = [...new Set([...revenueRows, ...expenseRows, ...purchaseRows].map((r) => r._id))].sort();
  const lookup = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.total]));
  const rev = lookup(revenueRows);
  const exp = lookup(expenseRows);
  const pur = lookup(purchaseRows);

  const points = keys.map((k) => ({
    period: k,
    revenue: Math.round((rev[k] || 0) * 100) / 100,
    expenses: Math.round((exp[k] || 0) * 100) / 100,
    purchases: Math.round((pur[k] || 0) * 100) / 100,
  }));

  const sum = (f) => Math.round(points.reduce((t, p) => t + p[f], 0) * 100) / 100;

  res.json({
    from: range.$gte,
    to: range.$lte,
    granularity: granularity === 'month' ? 'month' : 'day',
    points,
    totals: { revenue: sum('revenue'), expenses: sum('expenses'), purchases: sum('purchases') },
  });
});

// ---------------------------------------------------------------------------
// Inventory reconciliation.
//
// /accounts/reconcile and /finance/position both proved TRUE while a purchase
// order had received 10 units against an order of 5 — stock sits outside the
// ledger and outside AR/AP, so no financial invariant could see it.
//
// This adds the missing check. It is strictly read-only and derives everything
// from the existing authoritative records; it introduces no second source of
// truth and never adjusts a balance to make itself pass.
//
// Detected:
//   received > ordered on any purchase-order line   (the receiving race)
//   negative received                               (impossible state)
//   negative stock on an active product             (impossible state)
// ---------------------------------------------------------------------------
export const inventoryReconcile = asyncHandler(async (_req, res) => {
  const overReceived = await PurchaseOrder.aggregate([
    { $match: { status: { $nin: ['cancelled', 'draft'] } } },
    { $unwind: '$items' },
    { $match: { $expr: { $gt: ['$items.received', '$items.quantity'] } } },
    {
      $project: {
        _id: 0,
        purchaseOrder: '$_id',
        number: 1,
        status: 1,
        product: '$items.product',
        sku: '$items.sku',
        name: '$items.name',
        ordered: '$items.quantity',
        received: '$items.received',
        excess: { $subtract: ['$items.received', '$items.quantity'] },
      },
    },
    { $sort: { number: 1 } },
    { $limit: 200 },
  ]);

  const negativeReceived = await PurchaseOrder.aggregate([
    { $unwind: '$items' },
    { $match: { 'items.received': { $lt: 0 } } },
    { $project: { _id: 0, purchaseOrder: '$_id', number: 1, sku: '$items.sku', received: '$items.received' } },
    { $limit: 200 },
  ]);

  const negativeStock = await Product.find({ active: true, stock: { $lt: 0 } })
    .select('name sku stock')
    .limit(200);

  // Receiving-path integrity.
  //
  // A global `Product.stock == sum(StockMovement)` invariant is NOT derivable here
  // and is deliberately not asserted: products are created with an opening stock,
  // and the Excel importer sets `stock` directly, with no movement in either case.
  // Claiming that invariant would flag legitimate data as corrupt.
  //
  // What IS exactly derivable is the receiving path itself, which is where the
  // concurrency defect lived: every unit received against a purchase order must
  // have produced exactly one purchase movement of the same size. Both sides come
  // from authoritative records, so any divergence is real.
  const receivedByProduct = await PurchaseOrder.aggregate([
    { $match: { status: { $nin: ['cancelled', 'draft'] } } },
    { $unwind: '$items' },
    { $match: { 'items.received': { $gt: 0 } } },
    { $group: { _id: '$items.product', received: { $sum: '$items.received' } } },
  ]);
  const movedByProduct = await StockMovement.aggregate([
    { $match: { type: 'purchase', refType: 'PurchaseOrder' } },
    { $group: { _id: '$product', moved: { $sum: '$quantity' } } },
  ]);
  const movedMap = new Map(movedByProduct.map((m) => [String(m._id), m.moved]));
  const receiptDrift = [];
  for (const row of receivedByProduct) {
    const moved = movedMap.get(String(row._id)) || 0;
    if (moved !== row.received) {
      receiptDrift.push({ product: row._id, receivedOnOrders: row.received, purchaseMovements: moved, drift: moved - row.received });
    }
  }
  // Movements referencing a product with no corresponding receipts at all.
  for (const [pid, moved] of movedMap) {
    if (!receivedByProduct.find((r) => String(r._id) === pid) && moved !== 0) {
      receiptDrift.push({ product: pid, receivedOnOrders: 0, purchaseMovements: moved, drift: moved });
    }
  }

  const issues = overReceived.length + negativeReceived.length + negativeStock.length + receiptDrift.length;

  res.json({
    ok: issues === 0,
    checkedAt: new Date(),
    issues,
    // Each entry names the purchase order and the line, so a failure is actionable
    // rather than merely a red flag.
    overReceived,
    negativeReceived,
    negativeStock,
    receiptDrift,
    note: 'Product.stock is not compared against the sum of all StockMovements: opening stock and Excel imports set stock directly without a movement, so that equality is not a property of this data model. The receiving path is reconciled exactly instead.',
  });
});
