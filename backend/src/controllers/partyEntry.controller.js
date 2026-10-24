import { requireSupportedCurrency } from '../utils/currencyPolicy.js';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import PartyEntry, { PartyEntryEvent } from '../models/PartyEntry.js';
import Account from '../models/Account.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import { postTransaction, resolveAccount, runAtomically, transactionsSupported } from '../utils/ledger.js';
import { logActivity } from '../utils/activity.js';

const fail = (status, message) => { const error = new Error(message); error.statusCode = status; throw error; };
const money = value => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') fail(400, 'Enter an amount with at most two decimal places');
  const n = Number(value), pennies = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(pennies) || Math.abs(n * 100 - pennies) > 0.000001) fail(400, 'Enter a non-negative amount with at most two decimal places');
  return pennies / 100;
};
const round = n => Math.round(n * 100) / 100;
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Enter a valid date (YYYY-MM-DD)');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) fail(400, 'Enter a valid date');
  return result;
}
function text(value, label, max = 500, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, `${label} is required and must be ${max} characters or fewer`);
  return value.trim();
}
const snapshot = e => e ? ({ total: e.total, paid: e.paid, balance: e.balance, status: e.status, date: e.date, reference: e.reference, description: e.description, version: e.version }) : null;

async function operate(req, res, action) {
  if (req.user?.role !== 'admin') fail(403, 'Only Admin can change payable or receivable entries');
  const entityType = { receivables: 'customer', payables: 'supplier' }[req.params.category];
  if (!entityType) fail(404, 'Unknown financial category');
  for (const key of ['id', ...(action === 'created' ? [] : ['entryId'])]) if (!mongoose.isValidObjectId(req.params[key])) fail(400, 'Invalid party or entry id');
  const allowed = ['reason', 'idempotencyKey', ...(action === 'created' || action === 'corrected' ? ['total', 'date', 'description', 'reference'] : []), ...(action === 'created' ? ['currency'] : ['expectedVersion']), ...(action === 'payment' ? ['amount', 'date', 'account', 'method', 'reference'] : [])];
  const unknown = Object.keys(req.body || {}).filter(key => !allowed.includes(key));
  if (unknown.length) fail(400, `Unsupported fields: ${unknown.join(', ')}`);
  const reason = text(req.body.reason, 'Reason');
  const idempotencyKey = text(req.body.idempotencyKey, 'Idempotency key', 200);
  if (action !== 'created' && (!Number.isSafeInteger(req.body.expectedVersion) || req.body.expectedVersion < 0)) fail(400, 'Reload the entry before changing it');
  if (!(await transactionsSupported())) fail(503, 'Financial entry changes require MongoDB transactions; no changes were made');
  await Promise.all([PartyEntry.init(), PartyEntryEvent.init(), FinancialTransaction.init()]);
  const Model = entityType === 'customer' ? Customer : Supplier;
  let result;
  try {
    result = await runAtomically(async session => {
      if (await PartyEntryEvent.exists({ idempotencyKey }).session(session)) fail(409, 'This action has already been recorded');
      const party = await Model.findById(req.params.id).session(session);
      if (!party) fail(404, `${entityType === 'customer' ? 'Customer' : 'Supplier'} not found`);
      let entry = action === 'created' ? null : await PartyEntry.findOne({ _id: req.params.entryId, entity: party._id, entityType }).session(session);
      if (action !== 'created' && !entry) fail(404, 'Entry not found for this party');
      if (entry && entry.version !== req.body.expectedVersion) fail(409, 'Entry changed since it was loaded. Refresh and retry.');
      if (entry?.status === 'void') fail(409, 'This entry is void and cannot be changed');
      const before = snapshot(entry);
      const currency = entry?.currency || req.body.currency || 'PKR';
      if (!['PKR', 'GBP'].includes(currency) || (entityType === 'customer' && currency !== 'PKR')) fail(400, 'Customers support PKR; supplier entries support PKR or GBP');
      if (!['voided', 'payment_reversed'].includes(action)) requireSupportedCurrency(currency);
      const field = entityType === 'customer' ? 'balance' : currency === 'GBP' ? 'payableGBP' : 'payable';
      let transaction, eventDate = new Date();
      if (action === 'created' || action === 'corrected') {
        const total = money(req.body.total);
        if (total <= 0) fail(400, 'Total must be greater than zero; void an unpaid entry to remove it');
        if (total < (entry?.paid || 0)) fail(409, 'Total cannot be less than payments already recorded. Reverse the payment first.');
        const values = { total, balance: round(total - (entry?.paid || 0)), date: date(req.body.date), description: text(req.body.description, 'Description'), reference: text(req.body.reference ?? '', 'Reference', 200, false) };
        if (!entry) {
          [entry] = await PartyEntry.create([{ ...values, entityType, entity: party._id, currency, createdBy: req.user._id }], { session });
          eventDate = values.date;
        } else Object.assign(entry, values);
      } else if (action === 'voided') {
        if (entry.paid > 0) fail(409, 'Reverse active payments before voiding this entry');
        entry.status = 'void'; entry.balance = 0;
      } else if (action === 'payment') {
        const amount = money(req.body.amount);
        if (amount <= 0 || amount > entry.balance) fail(400, 'Payment must be greater than zero and cannot exceed this entry balance');
        const account = await resolveAccount(res, req.body.account);
        const accountSnapshot = await Account.findById(account._id).session(session);
        if (!accountSnapshot?.active) fail(400, 'Payment account is inactive or missing');
        if (accountSnapshot.currency !== currency) fail(400, 'Payment account currency must match the entry');
        if (!['cash', 'bank', 'cheque', 'other'].includes(req.body.method)) fail(400, 'Choose a valid payment method');
        const paymentDate = date(req.body.date);
        const reference = text(req.body.reference ?? '', 'Reference', 200, false);
        transaction = await postTransaction({ account: account._id, amount, currency, direction: entityType === 'customer' ? 'in' : 'out', type: entityType === 'customer' ? 'customer_payment' : 'supplier_payment', date: paymentDate, method: req.body.method, reference, description: `Standalone ${entityType === 'customer' ? 'receivable' : 'payable'} payment: ${entry.description}`, [entityType]: party._id, partyEntry: entry._id, createdBy: req.user._id, idempotencyKey: `party-entry:${idempotencyKey}` }, session);
        entry.payments.push({ transaction: transaction._id, amount, date: paymentDate, account: account._id, method: req.body.method, reference, createdBy: req.user._id });
        entry.paid = round(entry.paid + amount); entry.balance = round(entry.total - entry.paid);
        eventDate = paymentDate;
      } else if (action === 'payment_reversed') {
        if (!mongoose.isValidObjectId(req.params.paymentId)) fail(400, 'Invalid payment id');
        const payment = entry.payments.find(p => String(p.transaction) === req.params.paymentId);
        if (!payment) fail(404, 'Payment not found on this entry');
        if (payment.reversed) fail(409, 'This payment has already been reversed');
        const original = await FinancialTransaction.findById(payment.transaction).session(session);
        if (!original || String(original.partyEntry) !== String(entry._id)) fail(409, 'Original ledger entry is missing or does not match');
        transaction = await postTransaction({ account: original.account, amount: original.amount, currency, direction: original.direction === 'in' ? 'out' : 'in', type: 'payment_reversal', date: eventDate, description: `Standalone payment reversal: ${reason}`, reference: original.reference, [entityType]: party._id, partyEntry: entry._id, reversalOf: original._id, createdBy: req.user._id, idempotencyKey: `party-entry:${idempotencyKey}` }, session);
        payment.reversed = true; payment.reversalTransaction = transaction._id;
        entry.paid = round(entry.paid - payment.amount); entry.balance = round(entry.total - entry.paid);
      }
      const delta = round(entry.balance - (before?.balance || 0));
      if (round((party[field] || 0) + delta) < 0) fail(409, 'This action would make the party balance negative. Reconcile existing balance corrections first.');
      const newPartyBalance = money(round((party[field] || 0) + delta));
      if (before) entry.version += 1;
      await entry.save({ session });
      const updatedParty = await Model.findOneAndUpdate({ _id: party._id, [field]: party[field] || 0 }, { $set: { [field]: newPartyBalance } }, { new: true, session });
      if (!updatedParty) fail(409, 'Party balance changed. Refresh and retry.');
      const [event] = await PartyEntryEvent.create([{ entry: entry._id, entityType, entity: party._id, currency, action, date: eventDate, reason, reference: entry.reference, before, after: snapshot(entry), delta, transaction: transaction?._id, idempotencyKey, createdBy: req.user._id }], { session });
      return { entry, event };
    });
  } catch (error) {
    if (error?.code === 11000) fail(409, 'This action has already been recorded');
    throw error;
  }
  await logActivity(req, `party_entry_${action}`, { entity: 'PartyEntry', entityId: result.entry._id, meta: { eventId: result.event._id, entityType, party: req.params.id, before: result.event.before, after: result.event.after, reason } });
  res.status(action === 'created' || action === 'payment' ? 201 : 200).json(result);
}
export const createPartyEntry = asyncHandler((req, res) => operate(req, res, 'created'));
export const correctPartyEntry = asyncHandler((req, res) => operate(req, res, 'corrected'));
export const voidPartyEntry = asyncHandler((req, res) => operate(req, res, 'voided'));
export const payPartyEntry = asyncHandler((req, res) => operate(req, res, 'payment'));
export const reversePartyEntryPayment = asyncHandler((req, res) => operate(req, res, 'payment_reversed'));
