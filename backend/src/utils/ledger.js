import mongoose from 'mongoose';
import Account from '../models/Account.js';
import FinancialTransaction, { IN_TYPES, OUT_TYPES } from '../models/FinancialTransaction.js';

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------
// Recording a payment touches several documents (ledger row, account balance,
// invoice, customer). MongoDB can make that atomic, but only on a replica set or
// mongos — multi-document transactions are unavailable on a standalone mongod.
//
// This deployment runs an embedded standalone mongod in development
// (mongodb-memory-server, see config/db.js), so transactions are NOT available
// there. A production deployment against Atlas — which is always a replica set —
// does support them.
//
// So we probe once at runtime rather than assuming either way: if sessions work we
// use a real transaction and get true all-or-nothing semantics; if they don't we
// fall back to an ordered write plus an explicit compensating rollback, which is
// the safest pattern available without a replica set.
let txnSupport = null;

export async function transactionsSupported() {
  if (txnSupport !== null) return txnSupport;
  try {
    // Ask the server what it is. Note that startSession()/startTransaction() cannot
    // be used to probe this — they are lazy and never contact the server, so they
    // succeed even on a standalone and only fail on the first write inside the
    // transaction. Multi-document transactions require a replica set (hello.setName)
    // or a sharded cluster (hello.msg === 'isdbgrid').
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    txnSupport = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    txnSupport = false;
  }
  if (!txnSupport) {
    console.warn(
      '[ledger] MongoDB is standalone — multi-document transactions unavailable. ' +
        'Financial postings will use ordered writes with compensating rollback.'
    );
  }
  return txnSupport;
}

// Runs `work(session)`. With replica-set support the whole callback commits or
// aborts as one unit. Without it, session is null and the caller is responsible
// for compensating — see postPaymentAtomically below, which does exactly that.
export async function runAtomically(work) {
  if (await transactionsSupported()) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
  return work(null);
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------
const signOf = (direction) => (direction === 'in' ? 1 : -1);

// Creates the ledger row and moves the account balance by the same amount, so the
// two can never disagree. $inc is a single-document atomic operator, which keeps
// the balance correct under concurrent postings even without a transaction.
export async function postTransaction(entry, session = null) {
  const { account, amount, direction, type } = entry;
  if (!account) throw new Error('A financial account is required');
  if (!(amount > 0)) throw new Error('Amount must be > 0');
  if (!['in', 'out'].includes(direction)) throw new Error(`Invalid direction: ${direction}`);
  const valid = direction === 'in' ? IN_TYPES : OUT_TYPES;
  if (!valid.includes(type)) throw new Error(`Transaction type "${type}" is not valid for direction "${direction}"`);

  const [txn] = await FinancialTransaction.create([entry], session ? { session } : {});
  await Account.updateOne(
    { _id: account },
    { $inc: { currentBalance: signOf(direction) * amount } },
    session ? { session } : {}
  );
  return txn;
}

// Compensating action for the no-transaction fallback: undo a posting that was
// written before a later step failed.
export async function reverseTransaction(txn) {
  if (!txn) return;
  await Account.updateOne(
    { _id: txn.account },
    { $inc: { currentBalance: -signOf(txn.direction) * txn.amount } }
  );
  await FinancialTransaction.deleteOne({ _id: txn._id });
}

// The single entry point every payment flow uses (invoice payment, POS initial
// payment, supplier payment). Posts the ledger row first so the money movement is
// authoritative, then applies the document-level updates; if those fail without a
// transaction to roll them back, the posting is explicitly reversed.
//
// `applyDocumentUpdates(session, txn)` must perform the invoice/PO/customer/
// supplier writes and pass `session` through to every one of them.
export async function postPaymentAtomically(entry, applyDocumentUpdates) {
  return runAtomically(async (session) => {
    const txn = await postTransaction(entry, session);
    try {
      await applyDocumentUpdates(session, txn);
    } catch (e) {
      if (!session) await reverseTransaction(txn);
      throw e;
    }
    return txn;
  });
}

// Resolves and validates the account a payment is being made to/from.
export async function resolveAccount(res, accountId) {
  if (!accountId) {
    res.status(400);
    throw new Error('A payment account is required (cash or bank)');
  }
  if (!mongoose.isValidObjectId(accountId)) {
    res.status(400);
    throw new Error('Invalid payment account');
  }
  const account = await Account.findById(accountId);
  if (!account) {
    res.status(404);
    throw new Error('Payment account not found');
  }
  if (!account.active) {
    res.status(400);
    throw new Error(`Account "${account.name}" is inactive`);
  }
  return account;
}

// Turns the unique-index violation on idempotencyKey into a clear 409 so a retried
// request cannot post the same money twice.
export function rethrowDuplicatePosting(err, res) {
  if (err?.code === 11000 && err?.keyPattern?.idempotencyKey) {
    res.status(409);
    throw new Error('This payment has already been recorded (duplicate idempotency key)');
  }
  throw err;
}
