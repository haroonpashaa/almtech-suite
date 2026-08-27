import asyncHandler from 'express-async-handler';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Product from '../models/Product.js';
import Supplier from '../models/Supplier.js';
import StockMovement from '../models/StockMovement.js';
import { nextNumber } from '../utils/numbering.js';
import { logActivity } from '../utils/activity.js';
import { postPaymentAtomically, resolveAccount, rethrowDuplicatePosting } from '../utils/ledger.js';
import { resolvePayment, requireReason, assertReversible, postReversal } from '../services/paymentReversal.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';
import { requirePositiveWholeQuantity } from '../utils/quantity.js';

export const listPOs = asyncHandler(async (req, res) => {
  const { supplier, status } = req.query;
  const filter = {};
  if (supplier) filter.supplier = supplier;
  if (status) filter.status = status;
  const paging = resolvePaging(req.query, 500);
  const items = await runPaged(res, PurchaseOrder, filter, {
    sort: '-orderedAt',
    populate: [['supplier', 'name']],
    paging,
  });
  res.json(items);
});

export const getPO = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).populate('supplier').populate('createdBy', 'name');
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  res.json(po);
});

export const createPO = asyncHandler(async (req, res) => {
  const { supplier: supplierId, items, taxRate = 0, expectedAt, notes } = req.body;
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const product = await Product.findById(it.product);
    if (!product) {
      res.status(400);
      throw new Error(`Product not found: ${it.product}`);
    }
    const quantity = requirePositiveWholeQuantity(it.quantity, product.name);
    const lineTotal = quantity * it.unitCost;
    lines.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      quantity,
      received: 0,
      unitCost: it.unitCost,
      serials: it.serials || [],
      lineTotal,
    });
    subtotal += lineTotal;
  }
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const number = await nextNumber('po');
  const po = await PurchaseOrder.create({
    number,
    supplier: supplier._id,
    items: lines,
    subtotal,
    taxRate,
    taxAmount,
    total,
    balance: total,
    expectedAt,
    notes,
    createdBy: req.user._id,
  });
  supplier.payable += total;
  await supplier.save();
  await logActivity(req, 'po_created', { entity: 'PurchaseOrder', entityId: po._id, meta: { number, total } });
  res.status(201).json(po);
});

export const receiveItems = asyncHandler(async (req, res) => {
  const { receipts } = req.body;
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  // Validate every receipt before touching any stock — a malformed quantity anywhere
  // in the batch rejects the whole request rather than silently skipping that one
  // line while applying the rest (the atomic claim below has no way to undo a
  // partially-applied batch). Zero/negative/NaN were already harmless no-ops via the
  // `Math.max(0, Math.min(...))` clamp below, but a decimal (e.g. 1.5) was not — it
  // passed straight through and left the product with fractional stock.
  for (const r of receipts) {
    const line = po.items.find((l) => l.product.toString() === r.product);
    if (!line) continue;
    requirePositiveWholeQuantity(r.quantity, line.name);
  }
  for (const r of receipts) {
    const line = po.items.find((l) => l.product.toString() === r.product);
    if (!line) continue;
    const incoming = Math.max(0, Math.min(r.quantity, line.quantity - line.received));
    if (!incoming) continue;

    // Claim the quantity on the purchase-order line, then move stock by the amount
    // the DATABASE confirms was claimed — never by a locally computed number.
    //
    // Original defect: `line.received += incoming` on a stale in-memory document
    // followed by `po.save()`, so two concurrent receives both banked the full
    // remainder — a 5-unit order received 10 units. No financial reconciliation
    // caught it, because stock sits outside the ledger and outside AR/AP.
    //
    // A first attempt gated the stock movement on `updateOne(...).modifiedCount`.
    // That capped `received` correctly but stock still doubled under sustained
    // load, so the gate was not a sound proof of having won the claim.
    //
    // The claim is now expressed in the FILTER of a single findOneAndUpdate. The
    // document only matches while the line still has room for `incoming`, and
    // match-and-update is atomic, so a loser gets `null` — an unambiguous answer
    // that does not depend on interpreting a write-result count. Because the
    // filter proved the room existed at write time, the applied delta is exactly
    // `incoming`, and stock is moved by that same proven figure.
    const claimed = await PurchaseOrder.findOneAndUpdate(
      {
        _id: po._id,
        items: {
          $elemMatch: { product: line.product, received: { $lte: line.quantity - incoming } },
        },
      },
      { $inc: { 'items.$[line].received': incoming } },
      { arrayFilters: [{ 'line.product': line.product }], returnDocument: 'before' }
    );
    if (!claimed) continue;   // another request took the remainder — do nothing at all

    line.received += incoming;            // keep the in-memory copy in step

    // Stock is moved atomically and the post-image is returned, so `balanceAfter`
    // on the movement is the balance the database actually holds rather than a
    // figure derived from a document read before the increment.
    const movedProduct = await Product.findOneAndUpdate(
      { _id: line.product },
      { $inc: { stock: incoming }, $set: { purchasePrice: line.unitCost } },
      { returnDocument: 'after' }
    );
    if (movedProduct) {
      if (movedProduct.tracksSerials && r.serials?.length) {
        const fresh = r.serials.filter((sn) => !movedProduct.serials.find((x) => x.serial === sn));
        if (fresh.length) {
          await Product.updateOne(
            { _id: line.product },
            { $push: { serials: { $each: fresh.map((sn) => ({ serial: sn, status: 'in_stock' })) } } }
          );
        }
      }
      // Exactly one movement per successful claim, for exactly the claimed amount.
      await StockMovement.create({
        product: movedProduct._id,
        type: 'purchase',
        quantity: incoming,
        balanceAfter: movedProduct.stock,
        refType: 'PurchaseOrder',
        refId: po._id,
        refNumber: po.number,
        createdBy: req.user._id,
      });
    }
  }
  // Status is derived from what the DATABASE now holds, not from this request's
  // in-memory copy, and only the status field is written. Saving the whole document
  // would push a stale `items` array back over a concurrent request's claim — which
  // is precisely the lost update the arrayFilter above exists to prevent.
  const fresh = await PurchaseOrder.findById(po._id);
  const allReceived = fresh.items.every((l) => l.received >= l.quantity);
  const anyReceived = fresh.items.some((l) => l.received > 0);
  const status = allReceived ? 'received' : anyReceived ? 'partial' : fresh.status;
  if (status !== fresh.status) {
    await PurchaseOrder.updateOne({ _id: po._id }, { $set: { status } });
    fresh.status = status;
  }
  await logActivity(req, 'po_received', { entity: 'PurchaseOrder', entityId: po._id });
  res.json(fresh);
});

export const recordSupplierPayment = asyncHandler(async (req, res) => {
  const { amount, method = 'bank', reference, account: accountId, idempotencyKey } = req.body;
  if (!(amount > 0)) {
    res.status(400);
    throw new Error('Amount must be > 0');
  }
  const account = await resolveAccount(res, accountId);
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  if (po.balance <= 0) {
    res.status(400);
    throw new Error('This purchase order is already settled');
  }
  const cappedAmount = Math.min(amount, po.balance);

  // PO paid/balance and Supplier.payable behave exactly as before — the supplier
  // payable data preserved in Change 1 remains the payables source of truth. The
  // addition is the money-out ledger row against the paying account.
  try {
    await postPaymentAtomically(
      {
        account: account._id,
        amount: cappedAmount,
        direction: 'out',
        type: 'supplier_payment',
        method,
        reference,
        description: `Payment on purchase order ${po.number}`,
        purchaseOrder: po._id,
        supplier: po.supplier,
        createdBy: req.user._id,
        idempotencyKey,
      },
      async (session, posted) => {
        // Same atomic claim as the invoice side: conditional on the CURRENT
        // balance, so two concurrent supplier payments cannot both bank the same
        // remaining amount. A loser matches nothing, throws, and has its ledger
        // entry reversed by postPaymentAtomically — leaving no partial state.
        const claim = await PurchaseOrder.updateOne(
          { _id: po._id, balance: { $gte: cappedAmount } },
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
                      recordedBy: req.user._id,
                      account: account._id,
                      transaction: posted._id,
                      reversed: false,
                    }],
                  ],
                },
              },
            },
          ],
          session ? { session } : {}
        );
        if (!claim.matchedCount) {
          const err = new Error(
            'This payment could not be applied because the purchase-order balance changed — it may have just been paid by another request. Reload and try again.'
          );
          err.statusCode = 409;
          throw err;
        }

        await Supplier.updateOne(
          { _id: po.supplier },
          [{ $set: { payable: { $max: [0, { $subtract: ['$payable', cappedAmount] }] } } }],
          session ? { session } : {}
        );
      }
    );
  } catch (e) {
    rethrowDuplicatePosting(e, res);
  }

  await logActivity(req, 'supplier_payment', {
    entity: 'PurchaseOrder',
    entityId: po._id,
    meta: { amount: cappedAmount, account: account.name },
  });
  // Re-read: the payment is applied by a conditional update, so the copy loaded
  // above still shows the pre-payment figures.
  res.json(await PurchaseOrder.findById(po._id));
});

// ---------------------------------------------------------------------------
// Reverse a previously recorded supplier payment (admin only).
//
// Mirror image of the invoice reversal: the money goes back INTO the paying account,
// the purchase order's paid amount drops, and Supplier.payable is restored.
// ---------------------------------------------------------------------------
export const reverseSupplierPayment = asyncHandler(async (req, res) => {
  const reason = requireReason(res, req.body?.reason);

  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  if (po.status === 'cancelled') {
    res.status(409);
    throw new Error('This purchase order is cancelled, so its payments can no longer be reversed');
  }

  const { payment, index } = resolvePayment(res, po.payments, req.params.paymentId);
  const original = await assertReversible(res, payment);
  const amount = original.amount;

  const reversal = await postReversal(res, {
    original,
    payment,
    index,
    reason,
    user: req.user,
    description: `Reversal of payment on purchase order ${po.number} — ${reason}`,
    links: { purchaseOrder: po._id, supplier: po.supplier },
    applyDocumentUpdates: async (session) => {
      po.paid = Math.max(0, po.paid - amount);
      po.balance = Math.max(0, po.total - po.paid);
      // PO status tracks goods receipt, not payment — recordSupplierPayment never
      // touches it, so neither does the reversal.
      await po.save({ session });

      await Supplier.updateOne(
        { _id: po.supplier },
        { $inc: { payable: amount } },
        session ? { session } : {}
      );
    },
  });

  await logActivity(req, 'supplier_payment_reversed', {
    entity: 'PurchaseOrder',
    entityId: po._id,
    meta: { amount, reason, payment: index, reversalTransaction: reversal._id.toString() },
  });
  res.json(po);
});
