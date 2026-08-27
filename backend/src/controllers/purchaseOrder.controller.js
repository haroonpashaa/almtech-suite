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

// ---------------------------------------------------------------------------
// Edit an existing purchase order.
//
// Only an explicit, enumerated set of inputs is ever read from the request body:
// supplier, items ([{product, quantity, unitCost}]), taxRate, notes, expectedAt.
// Nothing else — not `received`, `paid`, `balance`, `status`, `payments`, `_id` or
// any other field — is ever trusted from the client; `received` in particular is
// always taken from the PO's own stored line, never from the request.
//
// Financial fields (supplier, items, taxRate) are editable only while the PO has
// no payments recorded and is not fully received (Rules 3 & 4) — this system has
// no per-receipt cost history, so a partially-received line's already-received
// units cannot be separated from its unreceived remainder for pricing purposes,
// and a PO with money already applied against it cannot have its total changed
// without risking an inconsistent balance. Within a still-editable PO, a line
// that has itself received any units keeps its quantity floor and its cost
// locked (Rule 2); a line with nothing received on it is fully editable, and may
// be removed or added freely. Notes/expectedAt are pure metadata and stay
// editable regardless of receiving/payment state, as long as the PO is not
// cancelled.
//
// Concurrency: rather than a multi-document transaction (unavailable on the
// standalone MongoDB this project runs against in development — see
// utils/ledger.js), this reuses the project's established atomic
// conditional-update idiom (the same shape as receiveItems' claim and
// recordSupplierPayment's balance check) — with one addition those don't need.
// receiveItems/recordSupplierPayment only ever *add* to a running figure, so
// re-reading fresh at request-start and matching against itself is enough to
// make the write atomic. An edit instead REPLACES fields based on what the
// client had on screen, so atomicity alone isn't sufficient — the check has to
// be against what the client last SAW, not what the server just re-read (those
// are the same thing if you only re-read inside this one request, which would
// make the check trivially pass every time and catch nothing).
//
// The client is therefore required to echo back `expectedUpdatedAt` — the PO's
// own `updatedAt` from when it loaded the PO into the edit form. `updatedAt` is
// the right signal for this rather than the Mongoose version key (`__v`):
// verified directly against this schema that receiveItems/recordSupplierPayment/
// reverseSupplierPayment all update `updatedAt` (Mongoose's automatic timestamps
// apply to every findOneAndUpdate/updateOne/save on this document, exactly
// because {timestamps: true} is on), but none of them touch `__v` (that only
// auto-increments on `.save()`, which none of those three use for their actual
// mutation). `__v` would therefore silently miss a receive or a payment that
// landed while the edit form was open — `updatedAt` does not.
export const updatePO = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  if (po.status === 'cancelled') {
    res.status(409);
    throw new Error('This purchase order is cancelled and cannot be edited');
  }
  if (!req.body.expectedUpdatedAt) {
    res.status(400);
    throw new Error('Missing expectedUpdatedAt — reload the purchase order before editing it');
  }
  const expected = new Date(req.body.expectedUpdatedAt);
  if (Number.isNaN(expected.getTime()) || expected.getTime() !== po.updatedAt.getTime()) {
    res.status(409);
    throw new Error('This purchase order changed since you opened it (received, paid, or edited elsewhere) — reload and try again.');
  }

  const { notes, expectedAt } = req.body;
  const wantsFinancialEdit = ['supplier', 'items', 'taxRate'].some((k) => req.body[k] !== undefined);

  if (!wantsFinancialEdit) {
    // Metadata-only edit — safe at any receiving/payment state.
    const setFields = {};
    if (notes !== undefined) setFields.notes = notes;
    if (expectedAt !== undefined) setFields.expectedAt = expectedAt;
    if (!Object.keys(setFields).length) {
      res.status(400);
      throw new Error('Nothing to update');
    }
    // Mongoose's automatic timestamps update `updatedAt` on this write, which is
    // exactly what makes it a valid "nothing changed since" proof for the *next*
    // request — no manual version bump needed.
    const updated = await PurchaseOrder.findOneAndUpdate(
      { _id: po._id, updatedAt: po.updatedAt },
      { $set: setFields },
      { new: true }
    );
    if (!updated) {
      res.status(409);
      throw new Error('This purchase order changed since you opened it — reload and try again.');
    }
    await logActivity(req, 'po_updated', { entity: 'PurchaseOrder', entityId: po._id });
    return res.json(await PurchaseOrder.findById(po._id).populate('supplier').populate('createdBy', 'name'));
  }

  // --- Financial edit: supplier, items and/or taxRate ---
  if (po.paid > 0) {
    res.status(409);
    throw new Error(
      'This purchase order has payments recorded against it, so its financial details can no longer be edited. ' +
        'Reverse the payment first if it was recorded in error.'
    );
  }
  if (po.status === 'received') {
    res.status(409);
    throw new Error('This purchase order has been fully received and its financial details can no longer be edited.');
  }
  if (!Array.isArray(req.body.items) || !req.body.items.length) {
    res.status(400);
    throw new Error('At least one item is required');
  }

  const anyReceivedAnywhere = po.items.some((l) => l.received > 0);
  const newSupplierId = req.body.supplier !== undefined ? String(req.body.supplier) : po.supplier.toString();
  const oldSupplierId = po.supplier.toString();
  const supplierChanged = newSupplierId !== oldSupplierId;
  if (supplierChanged && anyReceivedAnywhere) {
    res.status(409);
    throw new Error('The supplier cannot be changed once any item on this purchase order has been received.');
  }
  let newSupplier = null;
  if (supplierChanged) {
    newSupplier = await Supplier.findById(newSupplierId);
    if (!newSupplier) {
      res.status(404);
      throw new Error('Supplier not found');
    }
  }

  const existingByProduct = new Map(po.items.map((l) => [l.product.toString(), l]));
  const seenProducts = new Set();
  const newLines = [];
  let subtotal = 0;

  for (const it of req.body.items) {
    const product = await Product.findById(it.product);
    if (!product) {
      res.status(400);
      throw new Error(`Product not found: ${it.product}`);
    }
    const key = product._id.toString();
    if (seenProducts.has(key)) {
      res.status(400);
      throw new Error(`Duplicate product on this purchase order: ${product.name}`);
    }
    seenProducts.add(key);

    const existing = existingByProduct.get(key);
    const receivedSoFar = existing?.received || 0;
    const quantity = requirePositiveWholeQuantity(it.quantity, product.name);
    if (quantity < receivedSoFar) {
      res.status(400);
      throw new Error(`${product.name}: ordered quantity (${quantity}) cannot be less than the ${receivedSoFar} already received`);
    }

    let unitCost;
    if (receivedSoFar > 0) {
      // Cost is locked once any unit on this line has been received — see the
      // function-level comment for why. A request that doesn't even attempt to
      // change it (or resends the same value) is not an error.
      unitCost = existing.unitCost;
      if (it.unitCost !== undefined && Number(it.unitCost) !== unitCost) {
        res.status(409);
        throw new Error(`${product.name}: unit cost cannot be changed — ${receivedSoFar} unit(s) have already been received on this line at ${unitCost}.`);
      }
    } else {
      unitCost = Number(it.unitCost);
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        res.status(400);
        throw new Error(`Enter a valid unit cost for ${product.name}`);
      }
    }

    const lineTotal = quantity * unitCost;
    newLines.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      quantity,
      received: receivedSoFar,
      unitCost,
      serials: existing?.serials || [],
      lineTotal,
    });
    subtotal += lineTotal;
  }

  // A line missing from the new items array is a removal — only safe if nothing
  // was ever received against it.
  for (const [key, existing] of existingByProduct) {
    if (!seenProducts.has(key) && existing.received > 0) {
      res.status(400);
      throw new Error(`${existing.name}: cannot be removed — ${existing.received} unit(s) have already been received on this line.`);
    }
  }

  const taxRate = req.body.taxRate !== undefined ? Number(req.body.taxRate) : po.taxRate;
  if (!Number.isFinite(taxRate) || taxRate < 0) {
    res.status(400);
    throw new Error('Invalid tax rate');
  }
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const oldTotal = po.total;

  // Status follows the same derivation receiveItems uses — reducing an ordered
  // quantity down to exactly what's already received can legitimately close the
  // PO out as 'received' here, the same as receiving the last unit would.
  const allReceived = newLines.every((l) => l.received >= l.quantity);
  const anyReceived = newLines.some((l) => l.received > 0);
  const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status;

  const setFields = { items: newLines, subtotal, taxRate, taxAmount, total, balance: total, status: newStatus };
  if (supplierChanged) setFields.supplier = newSupplierId;
  if (notes !== undefined) setFields.notes = notes;
  if (expectedAt !== undefined) setFields.expectedAt = expectedAt;

  const updated = await PurchaseOrder.findOneAndUpdate(
    { _id: po._id, updatedAt: po.updatedAt },
    { $set: setFields },
    { new: true }
  );
  if (!updated) {
    res.status(409);
    throw new Error('This purchase order changed since you opened it (received, paid, or edited elsewhere) — reload and try again.');
  }

  // Supplier.payable is a plain running total (not ledger-backed — createPO simply
  // increments it, recordSupplierPayment/reverseSupplierPayment simply adjust it),
  // so keeping it correct here is the same kind of plain delta adjustment, applied
  // only after the PO write above is confirmed to have landed against the exact
  // state that was validated.
  if (supplierChanged) {
    await Supplier.updateOne({ _id: oldSupplierId }, { $inc: { payable: -oldTotal } });
    await Supplier.updateOne({ _id: newSupplierId }, { $inc: { payable: total } });
  } else {
    await Supplier.updateOne({ _id: oldSupplierId }, { $inc: { payable: total - oldTotal } });
  }

  await logActivity(req, 'po_updated', { entity: 'PurchaseOrder', entityId: po._id, meta: { total } });
  res.json(await PurchaseOrder.findById(po._id).populate('supplier').populate('createdBy', 'name'));
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
