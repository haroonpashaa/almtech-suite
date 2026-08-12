import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Account from '../models/Account.js';
import Settings from '../models/Settings.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { buildQuotation, buildPurchaseOrder, buildStatement, buildReceipt } from '../utils/pdf/index.js';
import { money } from '../utils/pdf/theme.js';

/* ---------------------------------------------------------------------------
   Printable documents.

   Every handler here is READ-ONLY. Nothing writes a document, posts a ledger
   entry, or touches a balance — generating a receipt must never be capable of
   changing what the receipt says. The figures printed are the ones the finance
   endpoints already derive, so a statement and the screen it mirrors cannot
   disagree.

   Authorisation deliberately mirrors the underlying record rather than inventing
   a new rule, so a PDF can never become a way around a permission:

     invoice / quotation      any authenticated user (matches GET /invoices/:id)
     purchase order           any authenticated user (matches GET /purchase-orders/:id)
     customer statement       admin + sales (matches GET /customers/:id/ledger)
     supplier statement       admin only (it is a payables document)
     account statement        admin only (it is an account ledger)
     receipts                 same as the parent document
   --------------------------------------------------------------------------- */

function requireObjectId(res, id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error(`Invalid ${label}`);
  }
  return id;
}

async function loadSettings() {
  return Settings.getSingleton();
}

const asOfLabel = (from, to) => {
  if (!from && !to) return null;
  const f = from ? new Date(from).toLocaleDateString('en-GB') : 'start';
  const t = to ? new Date(to).toLocaleDateString('en-GB') : 'today';
  return `${f} — ${t}`;
};

function inRange(date, from, to) {
  const d = new Date(date).getTime();
  if (from && d < new Date(from).getTime()) return false;
  // UTC for both ends: the date string parses as UTC midnight, so closing the day
  // with local hours drops late-in-day rows on any machine that is not on UTC.
  if (to && d > new Date(to).setUTCHours(23, 59, 59, 999)) return false;
  return true;
}

// ------------------------------------------------------------------ quotation

export const quotationPDF = asyncHandler(async (req, res) => {
  requireObjectId(res, req.params.id, 'quotation id');
  const quotation = await Quotation.findById(req.params.id).populate('customer');
  if (!quotation) {
    res.status(404);
    throw new Error('Quotation not found');
  }
  const settings = await loadSettings();
  buildQuotation({
    quotation: quotation.toObject(),
    customer: quotation.customer,
    settings,
    res,
    download: req.query.download === '1',
  });
});

// -------------------------------------------------------------- purchase order

export const purchaseOrderPDF = asyncHandler(async (req, res) => {
  requireObjectId(res, req.params.id, 'purchase order id');
  const po = await PurchaseOrder.findById(req.params.id).populate('supplier');
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  const settings = await loadSettings();
  buildPurchaseOrder({
    po: po.toObject(),
    supplier: po.supplier,
    settings,
    res,
    download: req.query.download === '1',
  });
});

// ---------------------------------------------------------- customer statement

/**
 * A customer's running account: what they were invoiced, what they paid, and what
 * remains. Built from the invoices themselves so it agrees with Customer.balance,
 * which stays the single source of truth for the receivable.
 */
export const customerStatementPDF = asyncHandler(async (req, res) => {
  requireObjectId(res, req.params.id, 'customer id');
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }
  const { from, to } = req.query;

  const [invoices, openings] = await Promise.all([
    Invoice.find({ customer: customer._id, status: { $nin: ['cancelled', 'draft'] } }).sort('issuedAt'),
    OpeningBalance.find({ entityType: 'customer', entity: customer._id }).sort('asOf'),
  ]);

  const events = [];
  for (const ob of openings) {
    events.push({
      date: ob.asOf, type: 'opening', typeLabel: 'Opening balance',
      description: 'Opening balance carried forward', reference: ob.reference || null,
      credit: ob.amount, debit: 0,
    });
  }
  for (const inv of invoices) {
    events.push({
      date: inv.issuedAt, type: 'invoice', typeLabel: 'Invoice',
      description: `Invoice ${inv.number}`, reference: inv.number,
      credit: inv.total, debit: 0,
    });
    for (const p of inv.payments || []) {
      events.push({
        date: p.date, type: 'payment', typeLabel: 'Payment',
        description: `Payment received${p.method ? ` (${p.method})` : ''}`,
        reference: p.reference || inv.number,
        credit: 0, debit: p.amount, reversed: !!p.reversed,
      });
      if (p.reversed) {
        events.push({
          date: p.reversedAt || p.date, type: 'reversal', typeLabel: 'Payment reversal',
          description: `Payment reversed${p.reversalReason ? ` — ${p.reversalReason}` : ''}`,
          reference: p.reference || inv.number, credit: p.amount, debit: 0,
        });
      }
    }
    if (inv.status === 'returned') {
      events.push({
        date: inv.updatedAt || inv.issuedAt, type: 'return', typeLabel: 'Return',
        description: `Invoice ${inv.number} returned`, reference: inv.number,
        credit: 0, debit: inv.total,
      });
    }
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  const all = events.map((e) => {
    running += (e.credit || 0) - (e.debit || 0);
    return { ...e, balance: Math.round(running * 100) / 100 };
  });
  const entries = all.filter((e) => inRange(e.date, from, to));

  const settings = await loadSettings();
  const totalCredit = entries.reduce((t, e) => t + (e.credit || 0), 0);
  const totalDebit = entries.reduce((t, e) => t + (e.debit || 0), 0);

  buildStatement({
    title: 'Customer Statement',
    filename: `statement-${customer.name}`,
    party: {
      label: 'Statement for',
      name: customer.name,
      lines: [customer.company, customer.phone, customer.email, customer.address].filter(Boolean),
    },
    entries,
    settings,
    periodLabel: asOfLabel(from, to),
    debitLabel: 'Paid',
    creditLabel: 'Invoiced',
    summary: [
      { label: 'Total invoiced', value: money(totalCredit, settings.currency) },
      { label: 'Total paid', value: money(totalDebit, settings.currency) },
      { divider: true },
      { label: 'BALANCE OUTSTANDING', value: money(Number(customer.balance || 0), settings.currency), grand: true },
    ],
    footerNote: `Statement · ${customer.name}`,
    res,
    download: req.query.download === '1',
  });
});

// ---------------------------------------------------------- supplier statement

/**
 * Reuses exactly the events the supplier ledger screen shows (Change 8 reversals
 * and Change 7 opening balances included), so the printed statement and the
 * on-screen ledger cannot disagree.
 */
export const supplierStatementPDF = asyncHandler(async (req, res) => {
  requireObjectId(res, req.params.id, 'supplier id');
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const { from, to } = req.query;

  const [pos, openings] = await Promise.all([
    PurchaseOrder.find({ supplier: supplier._id, status: { $nin: ['cancelled', 'draft'] } }).sort('orderedAt'),
    OpeningBalance.find({ entityType: 'supplier', entity: supplier._id }).sort('asOf'),
  ]);

  const events = [];
  for (const ob of openings) {
    events.push({
      date: ob.asOf, typeLabel: 'Opening balance',
      description: 'Opening balance carried forward', reference: ob.reference || null,
      credit: ob.amount, debit: 0,
    });
  }
  for (const po of pos) {
    events.push({
      date: po.orderedAt, typeLabel: 'Purchase',
      description: `Purchase order ${po.number}`, reference: po.number,
      credit: po.total, debit: 0,
    });
    for (const p of po.payments || []) {
      events.push({
        date: p.date, typeLabel: 'Payment',
        description: `Payment made${p.method ? ` (${p.method})` : ''}`,
        reference: p.reference || po.number, credit: 0, debit: p.amount,
      });
      if (p.reversed) {
        events.push({
          date: p.reversedAt || p.date, typeLabel: 'Payment reversal',
          description: `Payment reversed${p.reversalReason ? ` — ${p.reversalReason}` : ''}`,
          reference: p.reference || po.number, credit: p.amount, debit: 0,
        });
      }
    }
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  const all = events.map((e) => {
    running += (e.credit || 0) - (e.debit || 0);
    return { ...e, balance: Math.round(running * 100) / 100 };
  });
  const entries = all.filter((e) => inRange(e.date, from, to));

  const settings = await loadSettings();
  const cur = settings.currency || 'PKR';
  const totalCredit = entries.reduce((t, e) => t + (e.credit || 0), 0);
  const totalDebit = entries.reduce((t, e) => t + (e.debit || 0), 0);

  buildStatement({
    title: 'Supplier Statement',
    filename: `statement-${supplier.name}`,
    party: {
      label: 'Statement for',
      name: supplier.name,
      lines: [supplier.contactPerson, supplier.phone, supplier.email, supplier.address].filter(Boolean),
    },
    entries,
    settings,
    periodLabel: asOfLabel(from, to),
    debitLabel: 'Paid',
    creditLabel: 'Purchased',
    summary: [
      { label: 'Total purchased', value: money(totalCredit, cur) },
      { label: 'Total paid', value: money(totalDebit, cur) },
      { divider: true },
      { label: 'BALANCE PAYABLE', value: money(Number(supplier.payable || 0), cur), grand: true },
    ],
    footerNote: `Statement · ${supplier.name}`,
    res,
    download: req.query.download === '1',
  });
});

// ----------------------------------------------------------- account statement

export const accountStatementPDF = asyncHandler(async (req, res) => {
  requireObjectId(res, req.params.id, 'account id');
  const account = await Account.findById(req.params.id);
  if (!account) {
    res.status(404);
    throw new Error('Account not found');
  }
  const { from, to } = req.query;

  const filter = { account: account._id };
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to) filter.date.$lte = new Date(new Date(to).setUTCHours(23, 59, 59, 999));
  }
  const txns = await FinancialTransaction.find(filter).sort('date').limit(2000);

  let running = 0;
  const entries = txns.map((t) => {
    const isIn = t.direction === 'in';
    running += isIn ? t.amount : -t.amount;
    return {
      date: t.date,
      typeLabel: String(t.type || '').replace(/_/g, ' '),
      description: t.description || '—',
      reference: t.reference || null,
      debit: isIn ? t.amount : 0,
      credit: isIn ? 0 : t.amount,
      balance: Math.round(running * 100) / 100,
    };
  });

  const settings = await loadSettings();
  const cur = settings.currency || 'PKR';

  buildStatement({
    title: 'Account Statement',
    filename: `statement-${account.name}`,
    party: {
      label: 'Account',
      name: account.name,
      lines: [account.type && `Type: ${account.type}`, account.accountNumber && `No: ${account.accountNumber}`].filter(Boolean),
    },
    entries,
    settings,
    periodLabel: asOfLabel(from, to),
    debitLabel: 'Money in',
    creditLabel: 'Money out',
    summary: [
      { label: 'Money in', value: money(entries.reduce((t, e) => t + e.debit, 0), cur) },
      { label: 'Money out', value: money(entries.reduce((t, e) => t + e.credit, 0), cur) },
      { divider: true },
      { label: 'CURRENT BALANCE', value: money(Number(account.currentBalance || 0), cur), grand: true },
    ],
    footerNote: `Account statement · ${account.name}`,
    res,
    download: req.query.download === '1',
  });
});

// -------------------------------------------------------------------- receipts

export const invoiceReceiptPDF = asyncHandler(async (req, res) => {
  requireObjectId(res, req.params.id, 'invoice id');
  const invoice = await Invoice.findById(req.params.id).populate('customer');
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  const idx = Number(req.params.paymentIndex);
  const payment = (invoice.payments || [])[idx];
  if (!payment) {
    res.status(404);
    throw new Error('Payment not found');
  }
  const settings = await loadSettings();
  buildReceipt({
    payment: payment.toObject ? payment.toObject() : payment,
    kind: 'Payment',
    party: {
      label: 'Received from',
      name: invoice.customer?.name,
      lines: [invoice.customer?.company, invoice.customer?.phone, invoice.customer?.email].filter(Boolean),
    },
    document: {
      number: invoice.number, label: 'Invoice',
      total: invoice.total, paid: invoice.paid, balance: invoice.balance,
    },
    settings,
    res,
    download: req.query.download === '1',
  });
});

export const purchaseOrderReceiptPDF = asyncHandler(async (req, res) => {
  requireObjectId(res, req.params.id, 'purchase order id');
  const po = await PurchaseOrder.findById(req.params.id).populate('supplier');
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  const idx = Number(req.params.paymentIndex);
  const payment = (po.payments || [])[idx];
  if (!payment) {
    res.status(404);
    throw new Error('Payment not found');
  }
  const settings = await loadSettings();
  buildReceipt({
    payment: payment.toObject ? payment.toObject() : payment,
    kind: 'Payment',
    party: {
      label: 'Paid to',
      name: po.supplier?.name,
      lines: [po.supplier?.contactPerson, po.supplier?.phone, po.supplier?.email].filter(Boolean),
    },
    document: {
      number: po.number, label: 'Purchase order',
      total: po.total, paid: po.paid, balance: po.balance,
    },
    settings,
    res,
    download: req.query.download === '1',
  });
});
