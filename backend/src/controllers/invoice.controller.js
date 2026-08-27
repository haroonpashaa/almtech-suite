import asyncHandler from 'express-async-handler';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Settings from '../models/Settings.js';
import StockMovement from '../models/StockMovement.js';
import { nextNumber } from '../utils/numbering.js';
import { computeItemTotals, applyTax } from '../utils/totals.js';
import { logActivity } from '../utils/activity.js';
import { streamInvoicePDF } from '../utils/pdf.js';
import { postPaymentAtomically, resolveAccount, rethrowDuplicatePosting } from '../utils/ledger.js';
import { resolvePayment, requireReason, assertReversible, postReversal } from '../services/paymentReversal.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';
import { requirePositiveWholeQuantity } from '../utils/quantity.js';

// Single implementation of "money received against an invoice", shared by the POS
// initial payment and by later payments on the invoice detail screen.
//
// The invoice/customer maths is exactly what it was before Change 3 — capped at the
// outstanding balance, paid/balance/status recomputed, customer receivable reduced.
// What is new is that the same operation also posts a ledger row into the selected
// financial account, and the two are tied together (payment line -> transaction).
export async function applyInvoicePayment({ invoice, account, amount, method, reference, user, type, idempotencyKey }) {
  const cappedAmount = Math.min(amount, invoice.balance);
  if (!(cappedAmount > 0)) return null;

  return postPaymentAtomically(
    {
      account: account._id,
      amount: cappedAmount,
      direction: 'in',
      type,
      method,
      reference,
      description: `Payment on invoice ${invoice.number}`,
      invoice: invoice._id,
      customer: invoice.customer,
      createdBy: user._id,
      idempotencyKey,
    },
    async (session, posted) => {
      // The invoice is claimed with a single conditional update rather than a
      // read-modify-write on the document loaded above.
      //
      // The previous code did `invoice.paid += amount; invoice.save()` against a
      // stale in-memory copy. Two concurrent payments therefore both read paid=0
      // and both wrote paid=2000, while both pushed a payment line and both posted
      // to the ledger — reproduced on this database as 4,000 leaving the customer
      // and entering cash for a single 2,000 payment, leaving
      // `paid (2000) != sum of live payment lines (4000)` and AR unreconciled.
      //
      // `balance: { $gte: cappedAmount }` is evaluated by the database at write
      // time, so only a request that can still be covered by the CURRENT balance
      // applies. The loser matches nothing and throws, and postPaymentAtomically
      // reverses the ledger entry it had already written — so a rejected request
      // leaves no partial accounting state at all.
      const claim = await Invoice.updateOne(
        { _id: invoice._id, balance: { $gte: cappedAmount } },
        [
          {
            $set: {
              paid: { $add: ['$paid', cappedAmount] },
              balance: { $subtract: ['$balance', cappedAmount] },
              payments: {
                $concatArrays: [
                  { $ifNull: ['$payments', []] },
                  [{
                    amount: cappedAmount,
                    method,
                    reference,
                    date: new Date(),
                    recordedBy: user._id,
                    account: account._id,
                    transaction: posted._id,
                    reversed: false,
                  }],
                ],
              },
            },
          },
          // Derived from the balance this same operation just wrote, so status can
          // never disagree with the figure it describes.
          { $set: { status: { $cond: [{ $lte: ['$balance', 0] }, 'paid', 'partial'] } } },
        ],
        session ? { session } : {}
      );

      if (claim.matchedCount === 0) {
        const err = new Error(
          'This payment could not be applied because the invoice balance changed — it may have just been paid by another request. Reload the invoice and try again.'
        );
        err.statusCode = 409;
        throw err;
      }

      // Receivable lives on Customer.balance, as before — no second balance system.
      // Already a conditional pipeline update, so it was never part of the race.
      await Customer.updateOne(
        { _id: invoice.customer },
        [{ $set: { balance: { $max: [0, { $subtract: ['$balance', cappedAmount] }] } } }],
        session ? { session } : {}
      );
    }
  );
}

export const listInvoices = asyncHandler(async (req, res) => {
  const { customer, status, from, to, q } = req.query;
  const filter = {};
  if (customer) filter.customer = customer;
  if (status) filter.status = status;
  if (from || to) {
    filter.issuedAt = {};
    if (from) filter.issuedAt.$gte = new Date(from);
    if (to) filter.issuedAt.$lte = new Date(to);
  }
  if (q) filter.number = new RegExp(q, 'i');
  // 500 remains the default window, so an unparameterised call is unchanged.
  // What is new is X-Total-Count, which lets the client say what it is not showing.
  const paging = resolvePaging(req.query, 500);
  const items = await runPaged(res, Invoice, filter, {
    sort: '-issuedAt',
    populate: [['customer', 'name company phone']],
    paging,
  });
  res.json(items);
});

export const getInvoice = asyncHandler(async (req, res) => {
  const inv = await Invoice.findById(req.params.id).populate('customer').populate('createdBy', 'name');
  if (!inv) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  res.json(inv);
});

// A sale-time comment defaults to whatever is already on the product (e.g. "screen
// scratch"), but the salesperson may override or add to it for this specific sale —
// so an explicit `comments` on the line wins, and only falls back when omitted.
export function resolveLineComments(comments, product) {
  return comments ?? product.comments ?? '';
}

// The Invoice schema itself rejects quantity < 1, but only once Invoice.create()
// runs — well after stock has already been decremented below for the *other* lines
// in this sale. A non-integer quantity (e.g. 1.7) passes that schema check outright,
// since `min: 1` doesn't require a whole number, and would otherwise silently leave
// the product with fractional stock.
export const normalizeSaleQuantity = requirePositiveWholeQuantity;

async function buildLineFromProduct({ product, quantity, unitPrice, discount = 0, serials = [], comments }) {
  return {
    product: product._id,
    name: product.name,
    sku: product.sku,
    quantity,
    unitPrice,
    unitCost: product.purchasePrice,
    discount,
    serials,
    comments: resolveLineComments(comments, product),
    lineTotal: Math.max(0, quantity * unitPrice - discount),
  };
}

export const createInvoice = asyncHandler(async (req, res) => {
  const { customer: customerId, items, discount = 0, taxRate = 0, notes, initialPayment } = req.body;
  if (!items?.length) {
    res.status(400);
    throw new Error('At least one item is required');
  }
  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const lines = [];
  for (const it of items) {
    const product = await Product.findById(it.product);
    if (!product) {
      res.status(400);
      throw new Error(`Product not found: ${it.product}`);
    }
    const quantity = normalizeSaleQuantity(it.quantity, product.name);
    if (product.stock < quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for ${product.name} (have ${product.stock}, need ${quantity})`);
    }
    // Order matters: `it.product` is the raw id string from the request, so it must be
    // spread BEFORE `product` or it overwrites the fetched document and the line loses
    // its product ref.
    lines.push(await buildLineFromProduct({ ...it, quantity, product }));
  }

  const { items: enriched, subtotal } = computeItemTotals(lines);
  const { taxAmount, total } = applyTax({ subtotal, discount, taxRate });

  // `initialPayment` is an object ({ amount, method, account }); subtracting it directly
  // produced NaN, so the comparison was always false and the limit was never enforced on
  // a POS sale that took money up front. creditLimit === 0 still means "no limit".
  const upfront = Number(initialPayment?.amount) || 0;
  if (customer.creditLimit > 0 && customer.balance + total - upfront > customer.creditLimit) {
    res.status(400);
    throw new Error(`This sale would exceed the customer's credit limit of ${customer.creditLimit}`);
  }

  // An initial payment needs an account to land in, and we validate that before
  // creating anything so a bad account can't leave a half-finished sale behind.
  const initialAccount = initialPayment?.amount > 0 ? await resolveAccount(res, initialPayment.account) : null;

  const number = await nextNumber('invoice');
  // The invoice is always created unpaid; any initial payment is then applied
  // through applyInvoicePayment below — the same path a later payment takes — so
  // there is exactly one implementation of "money received against an invoice".
  const balance = total;
  const invoice = await Invoice.create({
    number,
    customer: customer._id,
    items: enriched,
    subtotal,
    discount,
    taxRate,
    taxAmount,
    total,
    paid: 0,
    balance,
    payments: [],
    status: 'open',
    notes,
    createdBy: req.user._id,
  });

  for (const it of enriched) {
    const product = await Product.findById(it.product);
    product.stock -= it.quantity;
    if (it.serials?.length && product.tracksSerials) {
      for (const s of it.serials) {
        const sn = product.serials.find((x) => x.serial === s);
        if (sn) {
          sn.status = 'sold';
          sn.soldInvoice = invoice._id;
        }
      }
    }
    await product.save();
    await StockMovement.create({
      product: product._id,
      type: 'sale',
      quantity: -it.quantity,
      balanceAfter: product.stock,
      refType: 'Invoice',
      refId: invoice._id,
      refNumber: invoice.number,
      createdBy: req.user._id,
    });
  }

  customer.balance += balance;
  await customer.save();

  // Apply the POS initial payment, if any, through the shared path above.
  if (initialAccount) {
    try {
      await applyInvoicePayment({
        invoice,
        account: initialAccount,
        amount: initialPayment.amount,
        method: initialPayment.method || 'cash',
        reference: initialPayment.reference,
        user: req.user,
        type: 'sale_payment',
        idempotencyKey: initialPayment.idempotencyKey,
      });
    } catch (e) {
      // The invoice and its stock movements are already committed at this point.
      // Rather than unwind a completed sale, leave it recorded as unpaid and say so —
      // the payment can be retried from the invoice screen without re-selling stock.
      rethrowDuplicatePosting(e, res);
      res.status(502);
      throw new Error(
        `Invoice ${invoice.number} was created but the initial payment could not be posted ` +
          `(${e.message}). The invoice is saved as unpaid — record the payment from the invoice screen.`
      );
    }
  }

  await logActivity(req, 'invoice_created', {
    entity: 'Invoice',
    entityId: invoice._id,
    meta: { number, total, customer: customer.name },
  });
  // Re-read for the same reason as recordPayment: a POS initial payment is applied
  // by a conditional update, so the in-memory copy would still say unpaid.
  res.status(201).json(initialAccount ? await Invoice.findById(invoice._id) : invoice);
});

export const recordPayment = asyncHandler(async (req, res) => {
  const { amount, method = 'cash', reference, account: accountId, idempotencyKey } = req.body;
  if (!(amount > 0)) {
    res.status(400);
    throw new Error('Amount must be > 0');
  }
  const account = await resolveAccount(res, accountId);
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  if (invoice.balance <= 0) {
    res.status(400);
    throw new Error('This invoice is already settled');
  }
  let txn;
  try {
    txn = await applyInvoicePayment({
      invoice,
      account,
      amount,
      method,
      reference,
      user: req.user,
      type: 'customer_payment',
      idempotencyKey,
    });
  } catch (e) {
    rethrowDuplicatePosting(e, res);
  }

  await logActivity(req, 'payment_recorded', {
    entity: 'Invoice',
    entityId: invoice._id,
    meta: { amount: txn.amount, method, account: account.name, transaction: txn._id.toString() },
  });
  // Re-read: the payment is applied by a conditional database update, so the copy
  // loaded above still shows the pre-payment figures.
  res.json(await Invoice.findById(invoice._id).populate('customer'));
});

export const returnInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  if (invoice.status === 'returned' || invoice.status === 'cancelled') {
    res.status(400);
    throw new Error(`Invoice already ${invoice.status}`);
  }

  // ---------------------------------------------------------------------------
  // Refund what was actually received.
  //
  // Until now a return restored stock and cleared the remaining receivable but left the
  // money already collected sitting in the account, with no entry showing it had been
  // handed back. Every payment that has a ledger entry is now reversed through the same
  // Change 8 mechanism used by a manual reversal — money OUT of the account it came into,
  // the original payment preserved and marked, one reversing entry each.
  //
  // The customer arithmetic below is deliberately unchanged: reversing the payments first
  // raises invoice.balance back to the full total, so the existing
  // `customer.balance -= invoice.balance` still nets to exactly -originalOutstanding.
  //
  // A payment with no account (recorded before account tracking, or imported as historical)
  // has nothing to reverse. Rather than invent an account to refund it from, the whole
  // return is refused before anything is written.
  const refundable = invoice.payments
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.reversed);
  const unattributed = refundable.filter(({ p }) => !p.transaction || !p.account);
  if (unattributed.length) {
    res.status(409);
    throw new Error(
      `This invoice has ${unattributed.length} payment(s) with no financial account attached ` +
        '(recorded before account tracking, or imported as historical payments). They cannot be ' +
        'refunded automatically, so the return has been cancelled. Record the refund manually first.'
    );
  }

  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim()
    : 'Invoice returned';
  for (const { p, i } of refundable) {
    const original = await assertReversible(res, p);
    await postReversal(res, {
      original,
      payment: p,
      index: i,
      reason,
      user: req.user,
      description: `Refund on returned invoice ${invoice.number} — ${reason}`,
      links: { invoice: invoice._id, customer: invoice.customer },
      applyDocumentUpdates: async (session) => {
        invoice.paid = Math.max(0, invoice.paid - original.amount);
        invoice.balance = Math.max(0, invoice.total - invoice.paid);
        await invoice.save({ session });
        await Customer.updateOne(
          { _id: invoice.customer },
          { $inc: { balance: original.amount } },
          session ? { session } : {}
        );
      },
    });
  }

  for (const it of invoice.items) {
    const product = await Product.findById(it.product);
    if (!product) continue;
    product.stock += it.quantity;
    if (it.serials?.length && product.tracksSerials) {
      for (const s of it.serials) {
        const sn = product.serials.find((x) => x.serial === s);
        if (sn) {
          sn.status = 'returned';
          sn.soldInvoice = undefined;
        }
      }
    }
    await product.save();
    await StockMovement.create({
      product: product._id,
      type: 'return',
      quantity: it.quantity,
      balanceAfter: product.stock,
      refType: 'Invoice',
      refId: invoice._id,
      refNumber: invoice.number,
      createdBy: req.user._id,
    });
  }
  invoice.status = 'returned';
  await invoice.save();

  // Unchanged from before: clears whatever this invoice still had outstanding. Combined
  // with the refunds above the customer nets to -(original outstanding), which is correct —
  // they owe nothing on a returned invoice and have their money back.
  const customer = await Customer.findById(invoice.customer);
  if (customer) {
    customer.balance = Math.max(0, customer.balance - invoice.balance);
    await customer.save();
  }

  await logActivity(req, 'invoice_returned', { entity: 'Invoice', entityId: invoice._id });
  res.json(invoice);
});

export const invoicePDF = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate('customer');
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  const settings = await Settings.getSingleton();
  streamInvoicePDF(res, {
    invoice: invoice.toObject(),
    customer: invoice.customer,
    settings,
    download: req.query.download === '1',
  });
});

// ---------------------------------------------------------------------------
// Reverse a previously recorded invoice payment (admin only).
//
// The original payment line and its ledger entry are preserved untouched; a single
// reversing entry is posted in the opposite direction and the invoice, customer
// receivable and account balance are all restored by exactly the reversed amount.
// ---------------------------------------------------------------------------
export const reverseInvoicePayment = asyncHandler(async (req, res) => {
  const reason = requireReason(res, req.body?.reason);

  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  // Returned and cancelled invoices already had their receivable adjusted by a
  // different code path. Reversing a payment on one would mix two corrections and
  // could leave the customer balance wrong, so it is refused rather than guessed at.
  if (invoice.status === 'returned' || invoice.status === 'cancelled') {
    res.status(409);
    throw new Error(
      `This invoice is ${invoice.status}, so its payments can no longer be reversed. ` +
        'Reverse the payment before processing a return.'
    );
  }

  const { payment, index } = resolvePayment(res, invoice.payments, req.params.paymentId);
  const original = await assertReversible(res, payment);
  const amount = original.amount;

  const reversal = await postReversal(res, {
    original,
    payment,
    index,
    reason,
    user: req.user,
    description: `Reversal of payment on invoice ${invoice.number} — ${reason}`,
    links: { invoice: invoice._id, customer: invoice.customer },
    applyDocumentUpdates: async (session) => {
      invoice.paid = Math.max(0, invoice.paid - amount);
      invoice.balance = Math.max(0, invoice.total - invoice.paid);
      // Same status vocabulary the payment path uses — no new statuses introduced.
      invoice.status = invoice.balance === 0 ? 'paid' : invoice.paid > 0 ? 'partial' : 'open';
      await invoice.save({ session });

      // Receivable returns to Customer.balance, the existing source of truth.
      await Customer.updateOne(
        { _id: invoice.customer },
        { $inc: { balance: amount } },
        session ? { session } : {}
      );
    },
  });

  await logActivity(req, 'payment_reversed', {
    entity: 'Invoice',
    entityId: invoice._id,
    meta: { amount, reason, payment: index, reversalTransaction: reversal._id.toString() },
  });
  res.json(invoice);
});
