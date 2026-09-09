// ---------------------------------------------------------------------------
// One-time pre-delivery cleanup: empties every test/transactional collection,
// resets the 3 financial accounts and the document-numbering counters, and
// replaces demo login accounts with a single real admin established from
// BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD.
//
// Never touches: schema/model files, indexes, Settings' business-identity
// fields, or the Account documents themselves (only their balance fields).
//
// ADMIN-SAFETY (hardened): the bootstrap admin is established — created if
// the email is new, or upgraded in place (role, active, password) if a user
// with that email already exists — and independently re-verified BEFORE any
// other User is deleted, and before any business data is touched. Every
// other User is then deleted excluding that one admin's _id, and the final
// User count is verified to be exactly 1. There is no "delete everyone, then
// hope bootstrap succeeds" step anywhere in this file — see
// establishBootstrapAdmin() below.
//
// TRANSACTIONS: the whole execute sequence (admin establishment, other-user
// deletion, business-data clearing, Account/Settings resets) runs inside
// mongoose's runAtomically() (utils/ledger.js) — the exact same
// probe-then-fall-back helper the payment ledger already uses. Production
// Atlas is always a replica set, so real transactions apply there: any
// failure at any point rolls back everything, including the admin change.
// A standalone mongod (the embedded dev/test database) cannot do
// transactions at all — runAtomically() detects this and runs the same
// operations without a session; the admin-established-first ordering is
// what keeps that path safe, not the transaction.
//
// SAFETY:
//   - Runs in DRY RUN mode by default — connects, reports exact before/after
//     counts and the planned admin action, writes nothing.
//   - Only writes when invoked with --execute.
//   - Refuses to touch anything at all (dry run or real) if
//     BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD are missing, malformed,
//     or the password is under 10 characters — so a run can never end with
//     zero usable admins.
//
// This file is import-safe: `runCleanup()` is a plain exported function that
// never calls process.exit() and never runs itself on import — only the
// `import.meta.url === ...` guard at the bottom invokes it, and only when
// this file is executed directly as a script. A route or any other module
// can safely `import { runCleanup } from './cleanForDelivery.mjs'` without
// anything running as a side effect of that import — see
// productionCleanup.controller.js, which does exactly this.
//
// CONNECTION LIFECYCLE: pass `disconnectWhenDone: false` when calling this
// from a long-lived server process (the HTTP route does). connectDB() caches
// one shared connection for the whole app's lifetime (see config/db.js); the
// default (`disconnectWhenDone: true`, used by the CLI below) closes that
// connection when finished, which is correct for a one-shot script but would
// sever every OTHER request's database access if done from inside a running
// server.
//
// Usage:
//   node src/scripts/cleanForDelivery.mjs            # dry run (no writes)
//   node src/scripts/cleanForDelivery.mjs --execute   # actually runs it
// ---------------------------------------------------------------------------
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { runAtomically } from '../utils/ledger.js';

import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import Quotation from '../models/Quotation.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Expense from '../models/Expense.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import OpeningBalance from '../models/OpeningBalance.js';
import StockMovement from '../models/StockMovement.js';
import ImportBatch from '../models/ImportBatch.js';
import Activity from '../models/Activity.js';
import Account from '../models/Account.js';
import Settings from '../models/Settings.js';
import User from '../models/User.js';

// Collections cleared entirely (deleteMany({})), in dependency-safe order —
// logs/history first, then the transactional documents, then the parties,
// then inventory. See the cleanup plan for why this order.
export const CLEAR_MODELS = [
  ['StockMovement', StockMovement],
  ['Activity', Activity],
  ['ImportBatch', ImportBatch],
  ['FinancialTransaction', FinancialTransaction],
  ['Invoice', Invoice],
  ['Quotation', Quotation],
  ['PurchaseOrder', PurchaseOrder],
  ['Expense', Expense],
  ['OpeningBalance', OpeningBalance],
  ['Customer', Customer],
  ['Supplier', Supplier],
  ['Product', Product],
];

// Every model, for the before/after report — including the ones that are
// never cleared, so their document counts are visibly unchanged.
export const ALL_MODELS = [...CLEAR_MODELS, ['Account', Account], ['Settings', Settings], ['User', User]];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function countAll(label, { log }) {
  log(`\n--- ${label} ---`);
  const counts = {};
  for (const [name, Model] of ALL_MODELS) {
    counts[name] = await Model.countDocuments();
    log(`  ${name.padEnd(22)} ${counts[name]}`);
  }
  return counts;
}

// Reports which env var supplied the connection string (the NAME only, never
// the value) and, once connected, what kind of database it turned out to be —
// inferred from connection metadata, never by reading/printing the URI itself.
function sanitizedTargetReport({ log }) {
  const varUsed = ['MONGO_URI', 'MONGODB_URI', 'STORAGE_MONGODB_URI', 'DATABASE_URL'].find((k) => process.env[k]);
  const isProd = process.env.NODE_ENV === 'production';
  const report = {
    environment: process.env.NODE_ENV || '(not set)',
    connectionSource: varUsed ? `${varUsed} environment variable` : 'none set — embedded fallback',
    embeddedFallback: isProd ? 'disabled (production refuses it — see config/db.js)' : 'enabled (this is NOT production)',
  };
  log('\n--- TARGET (sanitized — no secrets shown) ---');
  log(`  Environment:            ${report.environment}`);
  log(`  Connection source:      ${report.connectionSource}`);
  log(`  Embedded DB fallback:   ${report.embeddedFallback}`);
  return { isProd, varUsed, report };
}

// Validates BOOTSTRAP_ADMIN_EMAIL/PASSWORD format only — no database access.
// Used both as the very first gate (before connecting at all) and to decide,
// in dry-run, whether it's even meaningful to look up the planned action.
function validateBootstrapAdminConfig() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return { ok: false, reason: 'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must both be set before this can run.' };
  if (!EMAIL_RE.test(email)) return { ok: false, reason: 'BOOTSTRAP_ADMIN_EMAIL is not a valid email address.' };
  if (password.length < 10) return { ok: false, reason: 'BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters.' };
  return { ok: true, email, password };
}

// Read-only — reports what establishBootstrapAdmin() WOULD do, for dry-run.
// Never writes.
async function planBootstrapAdmin(email) {
  const existing = await User.findOne({ email }).select('_id role active');
  if (!existing) return { action: 'create a new admin account' };
  return {
    action: existing.role === 'admin' && existing.active
      ? 'update the existing user with this email (already admin/active — password will still be reset)'
      : 'update the existing user with this email (promote to admin, activate, reset password)',
    existingUserId: String(existing._id),
    existingRole: existing.role,
    existingActive: existing.active,
  };
}

// The safe upsert. Creates the admin if the email is new; if a User with
// this email already exists (active or not, any role), it is promoted in
// place instead of causing a duplicate-email error — this is the "handle it
// safely" path requirement #3 asks for. Password is always reset to the
// configured one, so whoever runs this can always log in with the
// credentials they just set, regardless of what that account's previous
// password was. Re-reads and verifies the result before returning — a
// caller must never trust the in-memory document alone.
async function establishBootstrapAdmin(email, password, session) {
  const opts = session ? { session } : {};
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator';

  let user = await User.findOne({ email }, null, opts);
  if (user) {
    user.role = 'admin';
    user.active = true;
    user.password = password; // pre-save hook only re-hashes modified passwords
    await user.save(opts);
  } else {
    const [created] = await User.create([{ name, email, password, role: 'admin' }], opts);
    user = created;
  }

  const verified = await User.findById(user._id, null, opts);
  if (!verified || verified.role !== 'admin' || verified.active !== true) {
    throw new Error('Bootstrap admin could not be verified after being established (role/active mismatch).');
  }
  return verified;
}

// ---------------------------------------------------------------------------
// The reusable core. NEVER calls process.exit() — every stopping condition is
// a normal return value ({ ok: false, reason }) or, for a truly unexpected
// internal failure, a thrown Error. This is what makes it safe to call from
// an Express request handler (productionCleanup.controller.js) as well as
// from the CLI wrapper below.
//
// `log` defaults to console.log so CLI behavior is unchanged; the HTTP route
// passes its own collector so nothing has to go to stdout to be visible in
// the response.
// ---------------------------------------------------------------------------
export async function runCleanup({ execute = false, log = console.log, disconnectWhenDone = true } = {}) {
  log(execute ? '=== RUNNING FOR REAL (--execute) ===' : '=== DRY RUN (no writes — pass --execute to apply) ===');

  const target = sanitizedTargetReport({ log });

  // ---- Hard gate: execute is refused outright unless NODE_ENV=production.
  if (execute && !target.isProd) {
    const reason = `--execute refused because NODE_ENV is not "production" (currently "${process.env.NODE_ENV || '(not set)'}").`;
    log(`\nABORTED: ${reason}\nNothing was touched.`);
    return { ok: false, reason, target: target.report };
  }

  // ---- Pre-flight: refuse to proceed at all (dry-run OR execute) if the
  // configured admin credentials aren't even well-formed. No database
  // access has happened yet at this point.
  const adminConfig = validateBootstrapAdminConfig();
  if (!adminConfig.ok) {
    log(`\nABORTED: ${adminConfig.reason}\nNothing was touched.`);
    return { ok: false, reason: adminConfig.reason, target: target.report };
  }
  log(`Pre-flight OK — the bootstrap admin will be ${adminConfig.email} (password not logged).`);

  await connectDB();

  const host = mongoose.connection.host || '';
  const dbType = (host === '127.0.0.1' || host === 'localhost') ? 'Embedded (local, throwaway)'
    : host.endsWith('mongodb.net') ? 'MongoDB Atlas'
    : 'Other persistent MongoDB (non-Atlas host)';
  target.report.databaseType = dbType;
  target.report.databaseName = mongoose.connection.name;
  log(`  Database type:          ${dbType}`);
  log(`  Database name:          ${mongoose.connection.name}`);
  log('---------------------------------------------\n');

  const before = await countAll('BEFORE', { log });

  if (!execute) {
    // Dry-run validates everything it reasonably can without writing: env
    // format (above), and now the actual planned admin action, read-only.
    const adminPlan = await planBootstrapAdmin(adminConfig.email);
    log(`\nPlanned admin action: ${adminPlan.action}`);
    log('\nDry run only — no documents were changed. Re-run with execute to apply.');
    if (disconnectWhenDone) await mongoose.disconnect();
    return { ok: true, mode: 'dry-run', target: target.report, before, adminPlan };
  }

  const useTransactions = await import('../utils/ledger.js').then((m) => m.transactionsSupported());
  log(useTransactions
    ? 'Transactions ARE supported on this deployment — the whole cleanup runs as one atomic unit.'
    : 'Transactions are NOT supported here (standalone MongoDB) — falling back to the admin-established-first ordering for safety.');

  const actions = [];
  let outcome;
  try {
    outcome = await runAtomically(async (session) => {
      // ---- Step 1: establish the admin FIRST, before anything destructive.
      // If this throws, runAtomically's transaction (when available) aborts
      // everything below automatically; without a transaction, the throw
      // simply propagates up and NOTHING past this point has run yet.
      const admin = await establishBootstrapAdmin(adminConfig.email, adminConfig.password, session);
      actions.push(`Bootstrap administrator established and verified: ${admin.email}`);
      log(actions[actions.length - 1]);

      // ---- Step 2: remove every OTHER user, keeping only the admin above.
      const otherDeleteResult = await User.deleteMany({ _id: { $ne: admin._id } }, session ? { session } : {});
      actions.push(`Cleared other User accounts: ${otherDeleteResult.deletedCount} document(s) deleted`);
      log(actions[actions.length - 1]);

      const remainingUsers = await User.find({}, null, session ? { session } : {});
      if (remainingUsers.length !== 1 || String(remainingUsers[0]._id) !== String(admin._id)) {
        throw new Error(`Expected exactly 1 user (the admin) after cleanup, found ${remainingUsers.length}.`);
      }

      // ---- Step 3: only now, with the admin safely confirmed, clear
      // business/transactional data.
      const cleared = {};
      for (const [name, Model] of CLEAR_MODELS) {
        const result = await Model.deleteMany({}, session ? { session } : {});
        cleared[name] = result.deletedCount;
        const line = `Cleared ${name}: ${result.deletedCount} document(s) deleted`;
        log(line);
        actions.push(line);
      }

      // ---- Step 4: reset Account balances (documents kept).
      const acctResult = await Account.updateMany({}, { $set: { openingBalance: 0, currentBalance: 0 } }, session ? { session } : {});
      actions.push(`Reset Account balances: ${acctResult.modifiedCount} account(s) zeroed`);
      log(actions[actions.length - 1]);

      // ---- Step 5: reset Settings numbering counters only.
      await Settings.updateOne({}, { $set: { invoiceNextNumber: 1, quotationNextNumber: 1, poNextNumber: 1 } }, session ? { session } : {});
      actions.push('Reset Settings numbering counters (invoice/quotation/PO) to 1');
      log(actions[actions.length - 1]);

      return { adminEmail: admin.email, cleared };
    });
  } catch (e) {
    const reason = e.message;
    log(`\nCRITICAL: ${reason}`);
    log(useTransactions
      ? 'Because this ran inside a transaction, it was rolled back automatically — nothing was actually changed.'
      : 'No transaction was available here — some earlier steps in this run may already be committed. Investigate immediately before retrying.');
    if (disconnectWhenDone) await mongoose.disconnect().catch(() => {});
    return { ok: false, reason, critical: true, target: target.report, before, actions };
  }

  const finalUserCount = await User.countDocuments();
  if (finalUserCount !== 1) {
    const reason = `Post-commit check failed: expected exactly 1 user, found ${finalUserCount}.`;
    log(`\nCRITICAL: ${reason} Investigate immediately.`);
    if (disconnectWhenDone) await mongoose.disconnect().catch(() => {});
    return { ok: false, reason, critical: true, target: target.report, before, actions };
  }

  const after = await countAll('AFTER', { log });

  log('\n=== SUMMARY ===');
  const summary = {};
  for (const [name] of ALL_MODELS) {
    summary[name] = { before: before[name], after: after[name] };
    log(`  ${name.padEnd(22)} ${before[name]} -> ${after[name]}`);
  }

  if (disconnectWhenDone) await mongoose.disconnect();
  log('\nDone.');
  return { ok: true, mode: 'execute', usedTransaction: useTransactions, target: target.report, before, after, summary, actions, adminEmail: outcome.adminEmail };
}

// ---------------------------------------------------------------------------
// CLI wrapper. Only runs when this file is executed directly (`node
// src/scripts/cleanForDelivery.mjs`), never when it's imported by another
// module — confirmed by the import.meta.url guard below. This is the only
// place in the file that ever calls process.exit().
// ---------------------------------------------------------------------------
async function main() {
  const execute = process.argv.includes('--execute');
  const result = await runCleanup({ execute });
  if (!result.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('\nFATAL — cleanup did not complete:', e);
    process.exit(1);
  });
}
