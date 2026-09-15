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
import { postPaymentAtomically, resolveAccount, rethrowDuplicatePosting, runAtomically } from '../utils/ledger.js';
import { resolvePayment, requireReason, assertReversible, postReversal } from '../services/paymentReversal.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';
import { requirePositiveWholeQuantity } from '../utils/quantity.js';
import { safeFilterValue } from '../utils/safeFilterValue.js';

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
  if (status) filter.status = safeFilterValue(status);
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

// Same "explicit line value wins, falls back to the product's own value" rule as
// resolveLineComments, applied to the sale-time name/spec snapshot fields a
// salesperson may correct without editing the product record itself.
function resolveLineText(value, fallback) {
  return value ?? fallback ?? '';
}

// The Invoice schema itself rejects quantity < 1, but only once Invoice.create()
// runs — well after stock has already been decremented below for the *other* lines
// in this sale. A non-integer quantity (e.g. 1.7) passes that schema check outright,
// since `min: 1` doesn't require a whole number, and would otherwise silently leave
// the product with fractional stock.
export const normalizeSaleQuantity = requirePositiveWholeQuantity;

// Validates a cart line's chosen serial numbers against the product's own inventory
// record. Serial numbers stay optional (unchanged from before) — a sale with none
// behaves exactly as it always has — but a line that does specify them must specify
// exactly one per unit being sold, each a real, currently in-stock serial on this
// product, with no serial claimed twice anywhere in this same sale. This is what
// makes an edited/selected serial number actually correspond to a real inventory
// unit rather than an arbitrary string the backend would otherwise trust blindly.
export function validateLineSerials({ product, quantity, serials, claimedSerials }) {
  if (!serials?.length) return [];
  if (!product.tracksSerials) {
    const err = new Error(`${product.name} does not track serial numbers`);
    err.statusCode = 400;
    throw err;
  }
  if (serials.length !== quantity) {
    const err = new Error(`${product.name}: selected ${serials.length} serial number(s) but quantity is ${quantity}`);
    err.statusCode = 400;
    throw err;
  }
  const seenInLine = new Set();
  for (const s of serials) {
    if (seenInLine.has(s) || claimedSerials.has(s)) {
      const err = new Error(`${product.name}: serial number "${s}" was selected more than once`);
      err.statusCode = 400;
      throw err;
    }
    const sn = product.serials.find((x) => x.serial === s);
    if (!sn) {
      const err = new Error(`${product.name}: serial number "${s}" was not found on this product`);
      err.statusCode = 400;
      throw err;
    }
    if (sn.status !== 'in_stock') {
      const err = new Error(`${product.name}: serial number "${s}" is not available (status: ${sn.status})`);
      err.statusCode = 400;
      throw err;
    }
    seenInLine.add(s);
    claimedSerials.add(s);
  }
  return serials;
}

// ---------------------------------------------------------------------------
// ALM-SEC-008 fix: the server, not the client, is the authority on what a
// line actually sells for. Previously `unitPrice`/`discount` were trusted
// verbatim from the request body for every role that can create a sale
// (today: admin and sales) — a sales-role client could set `unitPrice` to
// anything (confirmed live: a 249 catalogue item invoiced at 1) or apply an
// oversized `discount` to the same effect, with no check against the
// product's own price at all.
//
// This is deliberately NOT "sales can only sell at the catalogue price" —
// editing a line's price at sale time is an existing, intentionally-tested
// feature (see invoice.controller.test.js's "uses the edited cart price..."
// case, and POS.jsx/QuotationForm.jsx's editable price field), not something
// this fix is authorized to remove. There is also no existing concept
// anywhere in this codebase (schema, Settings, or UI) of a discount-limit or
// a distinct "admin pricing override" capability, so this doesn't invent a
// new percentage-based policy either.
//
// The boundary actually added: `admin` keeps its existing behavior
// completely unchanged (whatever it submits is used exactly as before). For
// every other price-setting role (today, only `sales`), both the submitted
// `unitPrice` and the effective per-unit price after `discount` are floored
// at the product's own `purchasePrice` (cost) — reusing data the schema
// already carries, the same cost figure this app already treats as
// sensitive (hidden from sales elsewhere), rather than a made-up limit. A
// sales user can still freely edit the price up or down, and still apply any
// discount, all the way down to cost; only selling at an actual loss
// requires admin — exactly what "the server remains the authority for
// price-sensitive calculations" requires, without touching the legitimate,
// already-tested editable-price behavior.
// ---------------------------------------------------------------------------
export function resolveLinePricing({ role, product, quantity, requestedUnitPrice, requestedDiscount }) {
  const discount = Number(requestedDiscount) || 0;
  if (role === 'admin') {
    return { unitPrice: requestedUnitPrice, discount };
  }

  const unitPrice = Number(requestedUnitPrice);
  const minUnitPrice = product.purchasePrice || 0;
  // A non-numeric/missing unitPrice is left alone here — the Invoice
  // schema's own `required`/`min: 0` validation rejects it with its own
  // clear message, same as before this fix existed.
  if (Number.isFinite(unitPrice) && unitPrice < minUnitPrice) {
    const err = new Error(
      `Price for ${product.name} is below cost (${minUnitPrice}) — an admin can authorize selling below cost if needed.`
    );
    err.statusCode = 400;
    throw err;
  }

  const maxDiscount = Math.max(0, quantity * (unitPrice - minUnitPrice));
  if (discount > maxDiscount) {
    const err = new Error(
      `Discount on ${product.name} would sell below cost — the maximum discount for this line is ${maxDiscount.toFixed(2)}. An admin can apply a larger discount if needed.`
    );
    err.statusCode = 400;
    throw err;
  }
  return { unitPrice, discount };
}

export async function buildLineFromProduct({ product, quantity, unitPrice, discount = 0, serials = [], comments, name, model, ram, processor, storage }) {
  return {
    product: product._id,
    name: resolveLineText(name, product.name),
    sku: product.sku,
    model: resolveLineText(model, product.model),
    ram: resolveLineText(ram, product.ram),
    processor: resolveLineText(processor, product.processor),
    storage: resolveLineText(storage, product.storage),
    quantity,
    unitPrice,
    unitCost: product.purchasePrice,
    discount,
    serials,
    comments: resolveLineComments(comments, product),
    lineTotal: Math.max(0, quantity * unitPrice - discount),
  };
}

// ---------------------------------------------------------------------------
// Shared atomic core for "commit an invoice's stock and receivable effects" —
// used by both direct invoice creation (createInvoice, below) and quotation
// conversion (quotation.controller.js's convertToInvoice), so there is
// exactly one implementation of this atomicity guarantee instead of two that
// can independently drift out of sync. This is the fix for ALM-SEC-015;
// extracting it here is what let convertToInvoice reuse it instead of
// maintaining its own separate (and separately vulnerable) copy.
//
// Must be called from inside runAtomically() — `session` is whatever that
// passed in (a real session on Atlas, or null on the standalone-dev fallback).
// On failure, compensates whatever it already committed IF no session is
// active (mirrors reverseTransaction() in utils/ledger.js) — a real
// transaction needs none of this, since the caller's runAtomically() aborts
// everything on throw.
//
// `invoiceFields` is the complete document to create (number, customer,
// items, totals, status, etc. — everything the caller has already computed
// and validated). `items` on it must be the same enriched line objects used
// to build totals, each carrying `product`, `quantity`, `name`, and
// (optionally) `serials`.
// ---------------------------------------------------------------------------
export async function commitInvoiceEffects({ session, invoiceFields, customerId, balanceIncrease, userId }) {
  const opts = session ? { session } : {};

  const [created] = await Invoice.create([invoiceFields], opts);

  const committed = [];
  try {
    for (const it of invoiceFields.items) {
      const claimed = await Product.findOneAndUpdate(
        { _id: it.product, stock: { $gte: it.quantity } },
        { $inc: { stock: -it.quantity } },
        { ...opts, new: true }
      );
      if (!claimed) {
        const err = new Error(`Insufficient stock for ${it.name} (needed ${it.quantity})`);
        err.statusCode = 400;
        throw err;
      }
      committed.push({ product: it.product, quantity: it.quantity, serials: [] });

      if (it.serials?.length && claimed.tracksSerials) {
        await Product.updateOne(
          { _id: it.product },
          { $set: { 'serials.$[s].status': 'sold', 'serials.$[s].soldInvoice': created._id } },
          { ...opts, arrayFilters: [{ 's.serial': { $in: it.serials }, 's.status': 'in_stock' }] }
        );
        // Verify every requested serial actually flipped — two concurrent
        // sales choosing the same physical unit is exactly as real a
        // conflict as running out of plain stock, and gets the same
        // treatment: fail this claim rather than silently double-sell it.
        const check = await Product.findOne({ _id: it.product }, { serials: 1 }, opts);
        const stillUnsold = it.serials.filter((s) => {
          const rec = check.serials.find((x) => x.serial === s);
          return !rec || rec.status !== 'sold' || String(rec.soldInvoice) !== String(created._id);
        });
        if (stillUnsold.length) {
          const err = new Error(`${it.name}: serial number "${stillUnsold[0]}" was just sold by another sale`);
          err.statusCode = 409;
          throw err;
        }
        committed[committed.length - 1].serials = it.serials;
      }

      await StockMovement.create(
        [{
          product: claimed._id,
          type: 'sale',
          quantity: -it.quantity,
          balanceAfter: claimed.stock,
          refType: 'Invoice',
          refId: created._id,
          refNumber: created.number,
          createdBy: userId,
        }],
        opts
      );
    }

    if (balanceIncrease) {
      // ALM-SEC-017 fix: the credit-limit check in createInvoice (and,
      // previously, the complete absence of one in convertToInvoice) only
      // ever read `customer.balance` once, before this point — a stale
      // pre-flight read that many concurrent requests can each pass
      // independently, since none of them see each other's increase before
      // deciding. The actual enforcement point has to be this atomic write,
      // exactly like the stock claim above: the filter re-reads the
      // customer's *current* balance and creditLimit from the database in
      // the same operation that commits the increase, so two concurrent
      // invoices can never both believe there's room. `creditLimit <= 0`
      // keeps meaning "no limit", matching the existing pre-flight check.
      const claimed = await Customer.updateOne(
        {
          _id: customerId,
          $expr: {
            $or: [
              { $lte: ['$creditLimit', 0] },
              { $lte: [{ $add: ['$balance', balanceIncrease] }, '$creditLimit'] },
            ],
          },
        },
        { $inc: { balance: balanceIncrease } },
        opts
      );
      if (claimed.matchedCount === 0) {
        const err = new Error("This sale would exceed the customer's credit limit");
        err.statusCode = 400;
        throw err;
      }
    }
  } catch (e) {
    if (!session) {
      // No transaction available (standalone dev database) — undo exactly
      // what this attempt actually committed, in the same spirit as
      // reverseTransaction() in utils/ledger.js. A real transaction needs
      // none of this: throwing out of this callback aborts the whole thing.
      for (const c of committed) {
        await Product.updateOne({ _id: c.product }, { $inc: { stock: c.quantity } });
        if (c.serials.length) {
          await Product.updateOne(
            { _id: c.product },
            { $set: { 'serials.$[s].status': 'in_stock' }, $unset: { 'serials.$[s].soldInvoice': '' } },
            { arrayFilters: [{ 's.serial': { $in: c.serials } }] }
          );
        }
      }
      await Invoice.deleteOne({ _id: created._id });
    }
    throw e;
  }

  return created;
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
  // Tracked across every line in this sale, not just within one, so the same
  // serial number cannot be claimed twice by two different lines in one request.
  const claimedSerials = new Set();
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
    const serials = validateLineSerials({ product, quantity, serials: it.serials, claimedSerials });
    const { unitPrice, discount: lineDiscount } = resolveLinePricing({
      role: req.user.role,
      product,
      quantity,
      requestedUnitPrice: it.unitPrice,
      requestedDiscount: it.discount,
    });
    // Order matters: `it.product` is the raw id string from the request, so it must be
    // spread BEFORE `product` or it overwrites the fetched document and the line loses
    // its product ref. `unitPrice`/`discount` are spread last so the server-resolved
    // values always win over whatever the client originally sent in `it`.
    lines.push(await buildLineFromProduct({ ...it, quantity, serials, product, unitPrice, discount: lineDiscount }));
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

  // ---------------------------------------------------------------------------
  // ALM-SEC-015 fix: invoice creation, every line's stock deduction, and the
  // customer receivable bump are one logically atomic operation, exactly like
  // applyInvoicePayment() above already treats a payment. On Atlas (a replica
  // set) this runs as a real multi-document transaction via runAtomically(); on
  // a standalone dev database (no transaction support) it falls back to ordered
  // writes with an explicit compensating rollback on failure — the same
  // architecture utils/ledger.js already uses everywhere else.
  //
  // Each line's stock is claimed with a single atomic conditional update
  // (`stock: { $gte: quantity }` in the filter, `$inc` in the update), never a
  // read-modify-write. The previous "read product.stock -> subtract in a JS
  // variable -> product.save()" pattern lost concurrent decrements under load:
  // ten simultaneous one-unit sales against a stock of 20 left stock at 13, not
  // 10, because most writes clobbered each other's stale in-memory copy instead
  // of composing — and the identical mistake on customer.balance silently lost
  // most of the receivable the same way. The pre-flight checks above still run
  // first (for a fast, friendly error on the overwhelmingly common
  // non-concurrent case) but the atomic claim below is the real enforcement
  // point: it is what actually prevents two concurrent requests from both
  // believing they're selling the last unit.
  // ---------------------------------------------------------------------------
  const invoice = await runAtomically((session) =>
    commitInvoiceEffects({
      session,
      invoiceFields: {
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
      },
      customerId: customer._id,
      balanceIncrease: balance,
      userId: req.user._id,
    })
  );

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

// ---------------------------------------------------------------------------
// Correct an invoice's notes — admin only, safe at any status.
//
// This deliberately touches nothing that money, stock or a customer's balance
// depends on: no items, prices, quantities, serials, totals or payments. That
// mirrors updatePO's own metadata-only path exactly (see its function-level
// comment) — an amendment that cannot corrupt accounting or inventory is always
// safe, regardless of what has already been paid or returned. A change to the
// sale itself (a wrong item, price or quantity) is not "safe" in that sense —
// it has already moved stock and money — so it goes through Return + a new
// sale, not through this endpoint.
// ---------------------------------------------------------------------------
export const updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  if (req.body?.notes === undefined) {
    res.status(400);
    throw new Error('Nothing to update');
  }
  const notes = String(req.body.notes ?? '');
  invoice.notes = notes;
  await invoice.save();
  await logActivity(req, 'invoice_updated', { entity: 'Invoice', entityId: invoice._id });
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

  // A return is a correction with real accounting/stock consequences, so — like a
  // payment reversal — it requires a stated reason. Captured on the activity log
  // below regardless of whether there was anything to refund, not just folded into
  // a refund's own description (which would silently lose it on an unpaid invoice).
  const reason = requireReason(res, req.body?.reason);
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

  await logActivity(req, 'invoice_returned', { entity: 'Invoice', entityId: invoice._id, meta: { reason } });
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

  // ALM-SEC-019 fix: the previous version recomputed invoice.paid/balance/
  // status from the in-memory `invoice` read at the top of this request and
  // wrote it back with a full-document invoice.save({session}). That save
  // touches every field Mongoose considers modified — including the whole
  // `payments` array — so if a genuinely concurrent payment had already
  // committed its own (correctly atomic) change in between, this save would
  // silently overwrite it: a real payment applied and reported success, then
  // vanished from `paid`/`payments` because a reversal of a *different*
  // payment happened to land afterward. Confirmed live: a 50 payment fired
  // concurrently with a reversal of an earlier 100 payment left `paid` at 0,
  // not 50.
  //
  // Fixed the same way ALM-SEC-015/018 were: atomic, targeted updates instead
  // of a read-modify-write, split into two atomic steps (a numeric array-index
  // path inside an aggregation-pipeline $set does not reliably address a
  // single array element on every MongoDB version this app may run against —
  // verified against this environment's own MongoDB, where it silently wrote
  // a stray literal `"0"` field into every payment subdocument instead of
  // indexing into the array; classic-update `arrayFilters` is the
  // version-safe way to target one array element, but arrayFilters cannot be
  // combined with aggregation-pipeline computed expressions in the same
  // update, hence two calls, not one):
  //
  //   1. A classic update with arrayFilters flips exactly the one payment
  //      being reversed — identified by its unique ledger transaction id
  //      (payment subdocuments have no _id of their own), guarded by its own
  //      `reversed: false` so two concurrent reversals of the same payment
  //      cannot both match.
  //   2. A separate aggregation-pipeline update recomputes paid/balance/
  //      status from the database's own current value at write time — the
  //      same technique applyInvoicePayment (above) already uses; this step
  //      touches no array elements, so it isn't affected by the limitation
  //      step 1 has to work around.
  const reversal = await postReversal(res, {
    original,
    payment,
    index,
    reason,
    user: req.user,
    description: `Reversal of payment on invoice ${invoice.number} — ${reason}`,
    links: { invoice: invoice._id, customer: invoice.customer },
    applyDocumentUpdates: async (session, posted) => {
      const opts = session ? { session } : {};

      const flipped = await Invoice.updateOne(
        { _id: invoice._id, payments: { $elemMatch: { transaction: original._id, reversed: false } } },
        {
          $set: {
            'payments.$[p].reversed': true,
            'payments.$[p].reversedAt': new Date(),
            'payments.$[p].reversedBy': req.user._id,
            'payments.$[p].reversalReason': reason,
            'payments.$[p].reversalTransaction': posted._id,
          },
        },
        { ...opts, arrayFilters: [{ 'p.transaction': original._id, 'p.reversed': false }] }
      );
      if (flipped.matchedCount === 0) {
        const err = new Error('This payment could not be reversed — it was already reversed by another request.');
        err.statusCode = 409;
        throw err;
      }

      try {
        await Invoice.updateOne(
          { _id: invoice._id },
          [
            { $set: { paid: { $max: [0, { $subtract: ['$paid', amount] }] } } },
            { $set: { balance: { $max: [0, { $subtract: ['$total', '$paid'] }] } } },
            {
              $set: {
                status: {
                  $cond: [
                    { $lte: ['$balance', 0] }, 'paid',
                    { $cond: [{ $gt: ['$paid', 0] }, 'partial', 'open'] },
                  ],
                },
              },
            },
          ],
          opts
        );
      } catch (e) {
        if (!session) {
          // Undo step 1 so this failed attempt doesn't leave the payment
          // marked reversed with no corresponding balance effect.
          await Invoice.updateOne(
            { _id: invoice._id },
            {
              $set: { 'payments.$[p].reversed': false },
              $unset: {
                'payments.$[p].reversedAt': '',
                'payments.$[p].reversedBy': '',
                'payments.$[p].reversalReason': '',
                'payments.$[p].reversalTransaction': '',
              },
            },
            { arrayFilters: [{ 'p.transaction': original._id }] }
          );
        }
        throw e;
      }

      // Receivable returns to Customer.balance, the existing source of truth.
      await Customer.updateOne({ _id: invoice.customer }, { $inc: { balance: amount } }, opts);
    },
  });

  await logActivity(req, 'payment_reversed', {
    entity: 'Invoice',
    entityId: invoice._id,
    meta: { amount, reason, payment: index, reversalTransaction: reversal._id.toString() },
  });
  // Re-read: the reversal is applied by a conditional database update, so the
  // in-memory copy loaded at the top of this request still shows the
  // pre-reversal figures (same reasoning as recordPayment's response, above).
  res.json(await Invoice.findById(invoice._id));
});
