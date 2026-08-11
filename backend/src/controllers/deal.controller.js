import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import StockMovement from '../models/StockMovement.js';

// ---------------------------------------------------------------------------
// Deal / transaction history
//
// There is deliberately NO Deal model. An Invoice already carries everything a sale
// deal needs — number, customer, date, line items, total/paid/balance/status and an
// embedded payments[] array whose entries already reference both the Account the money
// moved through and the FinancialTransaction that recorded it. PurchaseOrder carries
// the same for purchases. Introducing a Deal collection would duplicate financial
// state that is already authoritative somewhere else, so this module is a pure
// read-only presentation layer: it reads, joins and derives, and writes nothing.
//
// Every figure below comes from the existing records. No balance, payment, ledger row
// or total is stored, cached or recomputed into a new home.
// ---------------------------------------------------------------------------

// Cancelled / returned / draft documents keep their own meaning rather than being
// forced into the paid/partial/credit vocabulary — squeezing a returned invoice into
// "PAID" would misrepresent it.
const TERMINAL = { cancelled: 'CANCELLED', returned: 'RETURNED', draft: 'DRAFT' };

function dealStatus(doc) {
  if (TERMINAL[doc.status]) return TERMINAL[doc.status];
  if (doc.balance <= 0) return 'PAID';
  if (doc.paid > 0) return 'PARTIAL';
  return 'CREDIT';
}

// "Cash" here means settled in full, "credit" means money is still owed — which is the
// distinction the owner tracks. It is derived, never stored.
function settlementOf(doc) {
  if (TERMINAL[doc.status]) return null;
  return doc.balance <= 0 ? 'cash' : 'credit';
}

// Statuses excluded from money totals, matching how receivables/payables already treat
// them: a cancelled or returned document is not outstanding, and a draft was never issued.
const COUNTED = { $nin: ['cancelled', 'returned', 'draft'] };

function buildListMatch({ from, to, status, settlement, minAmount, maxAmount }, dateField) {
  const match = {};
  if (from || to) {
    match[dateField] = {};
    if (from) match[dateField].$gte = new Date(from);
    if (to) match[dateField].$lte = new Date(to);
  }
  if (minAmount || maxAmount) {
    match.total = {};
    if (minAmount) match.total.$gte = Number(minAmount);
    if (maxAmount) match.total.$lte = Number(maxAmount);
  }

  // Derived status translated into a real query so filtering stays server-side.
  const s = (status || '').toUpperCase();
  if (s === 'PAID') Object.assign(match, { status: COUNTED, balance: { $lte: 0 } });
  else if (s === 'PARTIAL') Object.assign(match, { status: COUNTED, balance: { $gt: 0 }, paid: { $gt: 0 } });
  else if (s === 'CREDIT') Object.assign(match, { status: COUNTED, balance: { $gt: 0 }, paid: { $lte: 0 } });
  else if (s === 'RETURNED') match.status = 'returned';
  else if (s === 'CANCELLED') match.status = 'cancelled';
  else if (s === 'DRAFT') match.status = 'draft';

  if (settlement === 'cash') Object.assign(match, { status: match.status || COUNTED, balance: { $lte: 0 } });
  else if (settlement === 'credit') Object.assign(match, { status: match.status || COUNTED, balance: { $gt: 0 } });

  return match;
}

// These are the field names AFTER the $project stage below (issuedAt/orderedAt become
// `date`, balance becomes `outstanding`), because the $sort runs inside the $facet
// that follows the projection. Sorting on the pre-projection names would silently
// match nothing and leave the order arbitrary.
const SORTABLE = { date: 'date', number: 'number', total: 'total', paid: 'paid', outstanding: 'outstanding' };

async function listDeals({ Model, dateField, partyField, partyCollection, query }) {
  const { q, sort = 'date', order = 'desc', page = 1, limit = 50 } = query;
  const dir = order === 'asc' ? 1 : -1;
  const sortField = SORTABLE[sort] || 'date';

  const match = buildListMatch(query, dateField);

  const pipeline = [
    { $match: match },
    { $lookup: { from: partyCollection, localField: partyField, foreignField: '_id', as: 'party' } },
    { $unwind: { path: '$party', preserveNullAndEmptyArrays: true } },
  ];

  // Search spans the deal number and the party's identifying fields, resolved in the
  // database rather than by shipping every row to the browser.
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    pipeline.push({
      $match: { $or: [{ number: rx }, { 'party.name': rx }, { 'party.company': rx }, { 'party.contactPerson': rx }] },
    });
  }

  pipeline.push({
    $project: {
      _id: 1,
      number: 1,
      date: `$${dateField}`,
      status: 1,
      total: 1,
      paid: 1,
      outstanding: '$balance',
      paymentCount: { $size: { $ifNull: ['$payments', []] } },
      partyId: '$party._id',
      partyName: '$party.name',
      partyCompany: '$party.company',
      itemCount: { $size: { $ifNull: ['$items', []] } },
    },
  });

  const facet = {
    rows: [{ $sort: { [sortField]: dir, _id: dir } }, { $skip: (Number(page) - 1) * Number(limit) }, { $limit: Number(limit) }],
    count: [{ $count: 'n' }],
    // Summary is computed over the whole filtered set, not just the current page, and
    // skips cancelled/returned/draft so the money totals mean something.
    summary: [
      { $match: { status: COUNTED } },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          paid: { $sum: '$paid' },
          outstanding: { $sum: '$outstanding' },
          deals: { $sum: 1 },
          creditDeals: { $sum: { $cond: [{ $gt: ['$outstanding', 0] }, 1, 0] } },
          paidDeals: { $sum: { $cond: [{ $lte: ['$outstanding', 0] }, 1, 0] } },
        },
      },
    ],
  };
  pipeline.push({ $facet: facet });

  const [result] = await Model.aggregate(pipeline);
  const rows = (result?.rows || []).map((r) => ({
    ...r,
    dealStatus: dealStatus({ status: r.status, paid: r.paid, balance: r.outstanding }),
    settlement: settlementOf({ status: r.status, balance: r.outstanding }),
  }));
  const s = result?.summary?.[0];

  return {
    rows,
    page: Number(page),
    limit: Number(limit),
    totalRows: result?.count?.[0]?.n || 0,
    summary: {
      total: s?.total || 0,
      paid: s?.paid || 0,
      outstanding: s?.outstanding || 0,
      deals: s?.deals || 0,
      creditDeals: s?.creditDeals || 0,
      paidDeals: s?.paidDeals || 0,
    },
    summaryNote: 'Totals exclude cancelled, returned and draft records.',
  };
}

export const listSaleDeals = asyncHandler(async (req, res) => {
  res.json({
    kind: 'sale',
    ...(await listDeals({
      Model: Invoice,
      dateField: 'issuedAt',
      partyField: 'customer',
      partyCollection: 'customers',
      query: req.query,
    })),
  });
});

export const listPurchaseDeals = asyncHandler(async (req, res) => {
  res.json({
    kind: 'purchase',
    ...(await listDeals({
      Model: PurchaseOrder,
      dateField: 'orderedAt',
      partyField: 'supplier',
      partyCollection: 'suppliers',
      query: req.query,
    })),
  });
});

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

// One payment history. The POS initial payment is an ordinary entry in the same
// payments[] array as every later payment — it is distinguishable only because its
// ledger row was typed 'sale_payment' rather than 'customer_payment'. There is no
// separate POS payment list anywhere.
function mapPayments(doc) {
  return (doc.payments || []).map((p, i) => ({
    seq: i + 1,
    date: p.date,
    amount: p.amount,
    method: p.method,
    reference: p.reference || null,
    account: p.account ? { _id: p.account._id, name: p.account.name, type: p.account.type } : null,
    recordedBy: p.recordedBy?.name || null,
    transaction: p.transaction
      ? { _id: p.transaction._id, direction: p.transaction.direction, type: p.transaction.type }
      : null,
    isInitial: p.transaction?.type === 'sale_payment',
    // Payments taken before Change 3 have no account attribution.
    legacy: !p.account,
    // A reversed payment stays in the history, clearly marked, never hidden.
    reversed: !!p.reversed,
    reversedAt: p.reversedAt || null,
    reversedBy: p.reversedBy?.name || null,
    reversalReason: p.reversalReason || null,
    reversalTransaction: p.reversalTransaction || null,
  }));
}

function buildTimeline(createdEvent, payments, extraEvents = []) {
  return [createdEvent, ...payments, ...extraEvents]
    .filter(Boolean)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

export const saleDeal = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid invoice id');
  }
  const invoice = await Invoice.findById(id)
    .populate('customer', 'name company phone email balance')
    .populate('createdBy', 'name')
    .populate('payments.account', 'name type')
    .populate('payments.recordedBy', 'name')
    .populate('payments.reversedBy', 'name')
    .populate('payments.transaction', 'direction type date');
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }

  const payments = mapPayments(invoice);
  const initialPayment = payments.filter((p) => p.isInitial).reduce((s, p) => s + p.amount, 0);

  // Returns are the one post-creation event an invoice records, and StockMovement
  // timestamps them. Nothing here is inferred — if no movement exists, no event shows.
  const returnMoves = await StockMovement.find({ refType: 'Invoice', refId: invoice._id, type: 'return' })
    .sort('createdAt')
    .limit(1);

  const timeline = buildTimeline(
    { at: invoice.issuedAt, kind: 'created', title: 'Invoice created', amount: invoice.total },
    [
      ...payments.map((p) => ({
        at: p.date,
        kind: 'payment',
        title: p.isInitial ? 'Initial payment received' : 'Payment received',
        amount: p.amount,
        account: p.account?.name || null,
        accountId: p.account?._id || null,
        method: p.method,
        by: p.recordedBy,
      })),
      // A reversal is its own event at the time it happened, not an edit of the original.
      ...payments.filter((p) => p.reversed).map((p) => ({
        at: p.reversedAt,
        kind: 'reversed',
        title: `Payment reversed${p.reversalReason ? ` — ${p.reversalReason}` : ''}`,
        amount: p.amount,
        account: p.account?.name || null,
        accountId: p.account?._id || null,
        by: p.reversedBy,
      })),
    ],
    returnMoves.map((m) => ({ at: m.createdAt, kind: 'returned', title: 'Invoice returned — stock restored', amount: null }))
  );

  res.json({
    kind: 'sale',
    _id: invoice._id,
    number: invoice.number,
    date: invoice.issuedAt,
    status: invoice.status,
    dealStatus: dealStatus(invoice),
    settlement: settlementOf(invoice),
    party: {
      type: 'customer',
      _id: invoice.customer?._id,
      name: invoice.customer?.name,
      company: invoice.customer?.company,
      phone: invoice.customer?.phone,
      // The single receivable figure maintained by the existing payment flow.
      storedBalance: invoice.customer?.balance,
    },
    items: invoice.items,
    totals: {
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      taxRate: invoice.taxRate,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      initialPayment,
      paid: invoice.paid,
      outstanding: invoice.balance,
    },
    payments,
    paymentCount: payments.length,
    totalPaid: invoice.paid,
    remaining: invoice.balance,
    // Link target only — the receivable amount itself is the invoice balance.
    receivable: invoice.balance > 0 && !TERMINAL[invoice.status]
      ? { customerId: invoice.customer?._id, customerName: invoice.customer?.name, outstanding: invoice.balance }
      : null,
    timeline,
    notes: invoice.notes || null,
    createdBy: invoice.createdBy?.name || null,
  });
});

export const purchaseDeal = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid purchase order id');
  }
  const po = await PurchaseOrder.findById(id)
    .populate('supplier', 'name contactPerson phone email payable')
    .populate('createdBy', 'name')
    .populate('payments.account', 'name type')
    .populate('payments.recordedBy', 'name')
    .populate('payments.reversedBy', 'name')
    .populate('payments.transaction', 'direction type date');
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }

  const payments = mapPayments(po);

  // Goods receipts are real, timestamped events. Movements written by one receive
  // action share a timestamp, so they are collapsed into a single event per receipt
  // rather than one row per product line.
  const receipts = await StockMovement.find({ refType: 'PurchaseOrder', refId: po._id, type: 'purchase' }).sort('createdAt');
  const grouped = new Map();
  for (const m of receipts) {
    const key = Math.floor(new Date(m.createdAt).getTime() / 1000);
    const g = grouped.get(key) || { at: m.createdAt, kind: 'received', title: 'Stock received', units: 0, lines: 0 };
    g.units += m.quantity;
    g.lines += 1;
    grouped.set(key, g);
  }

  const timeline = buildTimeline(
    { at: po.orderedAt, kind: 'created', title: 'Purchase order created', amount: po.total },
    payments.map((p) => ({
      at: p.date,
      kind: 'payment',
      title: 'Payment made',
      amount: p.amount,
      account: p.account?.name || null,
      accountId: p.account?._id || null,
      method: p.method,
      by: p.recordedBy,
    })),
    [...grouped.values()].map((g) => ({ ...g, title: `Stock received — ${g.units} unit${g.units === 1 ? '' : 's'} across ${g.lines} line${g.lines === 1 ? '' : 's'}` }))
  );

  res.json({
    kind: 'purchase',
    _id: po._id,
    number: po.number,
    date: po.orderedAt,
    expectedAt: po.expectedAt || null,
    status: po.status,
    dealStatus: dealStatus(po),
    settlement: settlementOf(po),
    party: {
      type: 'supplier',
      _id: po.supplier?._id,
      name: po.supplier?.name,
      contactPerson: po.supplier?.contactPerson,
      phone: po.supplier?.phone,
      storedPayable: po.supplier?.payable,
    },
    items: po.items,
    totals: {
      subtotal: po.subtotal,
      taxRate: po.taxRate,
      taxAmount: po.taxAmount,
      total: po.total,
      initialPayment: 0,
      paid: po.paid,
      outstanding: po.balance,
    },
    payments,
    paymentCount: payments.length,
    totalPaid: po.paid,
    remaining: po.balance,
    payable: po.balance > 0 && !TERMINAL[po.status]
      ? { supplierId: po.supplier?._id, supplierName: po.supplier?.name, outstanding: po.balance }
      : null,
    timeline,
    notes: po.notes || null,
    createdBy: po.createdBy?.name || null,
  });
});
