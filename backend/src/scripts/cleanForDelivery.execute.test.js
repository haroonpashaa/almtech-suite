import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { runCleanup } from './cleanForDelivery.mjs';

// ===========================================================================
// DB-backed tests for the hardened admin-replacement sequence. Every test
// here runs against a single throwaway MongoMemoryServer instance (standalone
// — no transactions available), which is exactly the environment where the
// "admin established first" ordering (rather than a transaction) is what
// keeps a failure from ever leaving zero usable admins.
//
// Seeding/verification goes through a raw MongoClient, deliberately NOT
// through mongoose: runCleanup() connects and disconnects mongoose's default
// connection itself (exactly like the real CLI/HTTP route does), and doing
// the same churn from the test on the same shared mongoose singleton caused
// exactly the kind of connect/disconnect race this file is designed to avoid.
// ===========================================================================

const ENV_KEYS = ['NODE_ENV', 'MONGO_URI', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'BOOTSTRAP_ADMIN_NAME'];
let envSnapshot;
beforeEach(() => { envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
  vi.restoreAllMocks();
});

describe('runCleanup() admin replacement — standalone (no transactions)', () => {
  // A fresh MongoMemoryServer per test rather than one shared instance —
  // runCleanup() disconnects mongoose's default connection when it finishes
  // (disconnectWhenDone defaults to true, matching real CLI usage), so each
  // test gets a clean, independent database and connection lifecycle instead
  // of depending on reconnect behavior working across back-to-back calls in
  // the same process. Each standalone instance starts in well under a second.
  let mem;
  let client;
  let db;

  beforeEach(async () => {
    mem = await MongoMemoryServer.create();
    client = await MongoClient.connect(mem.getUri());
    db = client.db();

    process.env.NODE_ENV = 'production';
    process.env.MONGO_URI = mem.getUri();
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'newadmin@example.com';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-genuinely-long-test-password';
  });

  afterEach(async () => {
    await client.close().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    await mem.stop();
  });

  it('creates a brand-new admin when the bootstrap email does not already belong to a user', async () => {
    await db.collection('users').insertOne({ name: 'Old Demo Admin', email: 'old-demo@example.com', password: 'hash-irrelevant', role: 'admin', active: true });
    await db.collection('products').insertOne({ name: 'Widget', sku: 'W-1', purchasePrice: 1, sellingPrice: 2, stock: 0 });

    const result = await runCleanup({ execute: true, log: () => {} });

    expect(result.ok).toBe(true);
    expect(result.adminEmail).toBe('newadmin@example.com');

    const users = await db.collection('users').find({}).toArray();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('newadmin@example.com');
    expect(users[0].role).toBe('admin');
    expect(users[0].active).toBe(true);
    const productCount = await db.collection('products').countDocuments();
    expect(productCount).toBe(0);
  });

  it('upgrades an existing user in place when the bootstrap email already belongs to someone, instead of creating a duplicate', async () => {
    const insertResult = await db.collection('users').insertOne({ name: 'Demo Sales', email: 'newadmin@example.com', password: 'old-hash', role: 'sales', active: false });
    const existingId = String(insertResult.insertedId);

    const result = await runCleanup({ execute: true, log: () => {} });

    expect(result.ok).toBe(true);
    expect(result.adminEmail).toBe('newadmin@example.com');

    const users = await db.collection('users').find({}).toArray();
    expect(users).toHaveLength(1);
    expect(String(users[0]._id)).toBe(existingId); // same document, upgraded in place — not a duplicate
    expect(users[0].role).toBe('admin');
    expect(users[0].active).toBe(true);
    expect(users[0].password).not.toBe('old-hash'); // password was reset (and re-hashed)
  });

  it('aborts BEFORE deleting any other user or any business data if the admin cannot be established, and leaves the system with at least one usable user', async () => {
    await db.collection('users').insertOne({ name: 'Old Demo Admin', email: 'old-demo@example.com', password: 'hash-irrelevant', role: 'admin', active: true });
    await db.collection('products').insertOne({ name: 'Widget', sku: 'W-1', purchasePrice: 1, sellingPrice: 2, stock: 0 });
    await db.collection('accounts').insertOne({ name: 'Cash', type: 'cash', openingBalance: 500, currentBalance: 500, active: true });

    const User = (await import('../models/User.js')).default;
    const createSpy = vi.spyOn(User, 'create').mockRejectedValueOnce(new Error('simulated admin-creation failure'));

    const result = await runCleanup({ execute: true, log: () => {} });

    expect(result.ok).toBe(false);
    expect(result.critical).toBe(true);
    createSpy.mockRestore();

    // Nothing was touched: the old demo admin is still there (no zero-admin
    // outcome), and business data was never reached.
    const users = await db.collection('users').find({}).toArray();
    expect(users.length).toBeGreaterThanOrEqual(1);
    expect(users.some((u) => u.role === 'admin')).toBe(true);
    const productCount = await db.collection('products').countDocuments();
    expect(productCount).toBe(1);
    const account = await db.collection('accounts').findOne({});
    expect(account.currentBalance).toBe(500);
  });

  it('dry-run reports the planned admin action without writing anything', async () => {
    await db.collection('users').insertOne({ name: 'Demo Sales', email: 'newadmin@example.com', password: 'old-hash', role: 'sales', active: true });

    const result = await runCleanup({ execute: false, log: () => {} });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('dry-run');
    expect(result.adminPlan).toBeTruthy();
    expect(result.adminPlan.action).toMatch(/update the existing user/);

    const user = await db.collection('users').findOne({ email: 'newadmin@example.com' });
    expect(user.role).toBe('sales'); // untouched — dry run never writes
  });
});

describe('runCleanup() dry-run prerequisite validation', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('rejects a malformed bootstrap email before connecting to any database', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'not-an-email';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-genuinely-long-test-password';
    const result = await runCleanup({ execute: false, log: () => {} });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/valid email/);
  });

  it('rejects a too-short bootstrap password', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'short';
    const result = await runCleanup({ execute: false, log: () => {} });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at least 10 characters/);
  });

  it('rejects a missing bootstrap password', async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com';
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const result = await runCleanup({ execute: false, log: () => {} });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must both be set/);
  });
});
