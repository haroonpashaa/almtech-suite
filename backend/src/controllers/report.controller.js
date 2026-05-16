import asyncHandler from 'express-async-handler';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';

function dateRange(from, to) {
  const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const t = to ? new Date(to) : new Date();
  return { $gte: f, $lte: t };
}

export const dashboard = asyncHandler(async (_req, res) => {
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
  const [result] = await Invoice.aggregate(pipeline);
  const revenue = result?.revenue || 0;
  const cost = result?.cost || 0;
  res.json({
    from: issuedAt.$gte,
    to: issuedAt.$lte,
    revenue,
    cost,
    grossProfit: revenue - cost,
    margin: revenue ? Math.round(((revenue - cost) / revenue) * 10000) / 100 : 0,
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
